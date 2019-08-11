import {
  DeletedTag,
  GenericComponent,
  measureAndSerialize,
  NetworkPeer,
  OutgoingMessage,
  PlayerId,
  SimluationFrameData,
  WriteStream,
  S2C_FrameDeletionsMessage,
  S2C_FrameComponentStateMessage,
  S2C_FrameInputsUsedMessage
} from 'laniakea-shared';
import { ComponentReplicationChooser } from './component-replication-chooser';

export interface ComponentAndSerializedData {
  component: GenericComponent;
  serializedData: Uint8Array;
}

export class FrameUpdateSender {
  constructor(
    private ourPlayerId: PlayerId,
    private networkPeer: NetworkPeer,
  ) {
  }

  public sendFrameUpdate(currentFrame: SimluationFrameData, componentsAndSerializedData: Array<ComponentAndSerializedData>) {
    this.sendFrameInputsUsedMessage(currentFrame);
    this.sendFrameComponentStateMessage(currentFrame, componentsAndSerializedData);
    // Deletions are a separate message that is sent with no expiry to ensure they eventually arrive
    this.sendDeletionsMessage(currentFrame);
  }

  private chooser = new ComponentReplicationChooser();
  private lastOutgoingInputsUsedMessage?: OutgoingMessage;
  private lastOutgoingComponentStateMessage?: OutgoingMessage;

  private sendFrameInputsUsedMessage(currentFrame: SimluationFrameData) {
    let inputsUsedMessage = new S2C_FrameInputsUsedMessage();
    inputsUsedMessage.simulationFrameIndex = currentFrame.simulationFrameIndex;
    inputsUsedMessage.simulationTimeS = currentFrame.simulationTimeS;
    let maybeInputs = currentFrame.inputs.get(this.ourPlayerId);
    if (maybeInputs !== undefined) {
      inputsUsedMessage.inputUsedForPlayerThisFrame = new Uint8Array(measureAndSerialize(maybeInputs));
    }
    else {
      inputsUsedMessage.inputUsedForPlayerThisFrame = new Uint8Array(0);
    }
    let outgoingMessage = this.networkPeer.sendMessage(inputsUsedMessage);
    if (this.lastOutgoingInputsUsedMessage !== undefined) {
      this.lastOutgoingInputsUsedMessage.expire();
    }
    this.lastOutgoingInputsUsedMessage = outgoingMessage;
  }

  private sendFrameComponentStateMessage(currentFrame: SimluationFrameData, componentsAndSerializedData: ComponentAndSerializedData[]) {
    let componentStateMessage = new S2C_FrameComponentStateMessage();
    componentStateMessage.simulationFrameIndex = currentFrame.simulationFrameIndex;
    componentStateMessage.simulationTimeS = currentFrame.simulationTimeS;
    // The smaller the message, the more likely it will fit in with other messages
    // For now, lets allocate half of our MTU for component replication
    let maxBytesComponentData = Math.round(this.networkPeer.getMtuForMessage() / 2);
    let componentsToSend = this.chooser.getComponentsToSend(componentsAndSerializedData, maxBytesComponentData);
    let componentBufferLen = componentsToSend.reduce((acc, next) => acc + (next.serializedData.byteLength), 0);
    componentStateMessage.componentData = new Uint8Array(componentBufferLen);
    let writeStream = new WriteStream(new DataView(componentStateMessage.componentData.buffer, componentStateMessage.componentData.byteOffset, componentStateMessage.componentData.byteLength));
    componentsToSend.forEach((c) => {
      c.component.serialize(writeStream);
    });
    let outgoingMessage = this.networkPeer.sendMessage(componentStateMessage, () => {
      this.chooser.onComponentsAcked(componentsToSend);
    });
    if (this.lastOutgoingComponentStateMessage !== undefined) {
      this.lastOutgoingComponentStateMessage.expire();
    }
    this.lastOutgoingComponentStateMessage = outgoingMessage;
  }

  private sendDeletionsMessage(currentFrame: SimluationFrameData) {
    let deletionsMessage = new S2C_FrameDeletionsMessage();
    deletionsMessage.simulationFrameIndex = currentFrame.simulationFrameIndex;
    deletionsMessage.simulationTimeS = currentFrame.simulationTimeS;
    for (let component of currentFrame.state.getAllComponents()) {
      if (component.isDeleted()) {
        let maybeDeletedTag = currentFrame.state.getComponentOfEntity(DeletedTag, component.getOwnerId());
        if (maybeDeletedTag === undefined) {
          // The owning entity is not deleted so add this component.
          // TODO, eliminate the kindId once componentId is a combo of entityId and KindId
          deletionsMessage.deletedComponentIds.push(component.getKindId());
          deletionsMessage.deletedComponentIds.push(component.getId());
        }
      }
      if ((component.getData() as Object).constructor === DeletedTag) {
        deletionsMessage.deletedEntityIds.push(component.getOwnerId());
      }
    }
    this.networkPeer.sendMessage(deletionsMessage);
  }
}
