import {
  ComponentAndSerializedData,
  ComponentId,
  DeletedTag,
  measureAndSerialize,
  measureSerializable,
  NetworkPeer,
  OutboundMessage,
  PlayerId,
  S2C_FrameComponentStateMessage,
  S2C_FrameDeletionsMessage,
  S2C_FrameInputsUsedMessage,
  SimulationFrameData,
  WriteStream,
} from 'laniakea-shared';
import { ComponentReplicationChooser } from './component-replication-chooser';

let SIZE_OF_COMPONENT_ID = measureSerializable(new ComponentId());

export class FrameUpdateSender {
  constructor(
    private ourPlayerId: PlayerId,
    private networkPeer: NetworkPeer,
  ) {
  }

  public sendFrameUpdate(currentFrame: SimulationFrameData, componentsAndSerializedData: ComponentAndSerializedData[]) {
    this.sendFrameInputsUsedMessage(currentFrame);
    this.sendFrameComponentStateMessage(currentFrame, componentsAndSerializedData);
    // Deletions are a separate message that is sent with no expiry to ensure they eventually arrive
    this.sendDeletionsMessage(currentFrame);
  }

  private chooser = new ComponentReplicationChooser();
  private lastOutboundInputsUsedMessage?: OutboundMessage;
  private lastOutboundComponentStateMessage?: OutboundMessage;

  private sendFrameInputsUsedMessage(currentFrame: SimulationFrameData) {
    let inputsUsedMessage = new S2C_FrameInputsUsedMessage();
    inputsUsedMessage.simulationFrameIndex = currentFrame.simulationFrameIndex;
    inputsUsedMessage.simulationTimeS = currentFrame.simulationTimeS;
    let maybeInputs = currentFrame.inputs.get(this.ourPlayerId);
    if (maybeInputs !== undefined) {
      inputsUsedMessage.inputUsedForPlayerThisFrame = new Uint8Array(measureAndSerialize(maybeInputs));
    } else {
      inputsUsedMessage.inputUsedForPlayerThisFrame = new Uint8Array(0);
    }
    let outboundMessage = this.networkPeer.sendMessage(inputsUsedMessage);
    if (this.lastOutboundInputsUsedMessage !== undefined) {
      this.lastOutboundInputsUsedMessage.expire();
    }
    this.lastOutboundInputsUsedMessage = outboundMessage;
  }

  private sendFrameComponentStateMessage(currentFrame: SimulationFrameData, componentsAndSerializedData: ComponentAndSerializedData[]) {
    let componentStateMessage = new S2C_FrameComponentStateMessage();
    componentStateMessage.simulationFrameIndex = currentFrame.simulationFrameIndex;
    componentStateMessage.simulationTimeS = currentFrame.simulationTimeS;
    // The smaller the message, the more likely it will fit in with other messages
    // For now, lets allocate half of our MTU for component replication
    // The final size will be larger once we add the component Ids to the message.
    let maxBytesComponentData = Math.round(this.networkPeer.getMtuForMessage() / 2);
    let componentsToSend = this.chooser.getComponentsToSend(componentsAndSerializedData, maxBytesComponentData);
    let componentBufferLen = componentsToSend.reduce((acc, next) => acc + SIZE_OF_COMPONENT_ID + next.serializedData.byteLength, 0);
    componentStateMessage.componentData = new Uint8Array(componentBufferLen);
    let writeStream = new WriteStream(
      new DataView(
        componentStateMessage.componentData.buffer,
        componentStateMessage.componentData.byteOffset,
        componentStateMessage.componentData.byteLength));
    componentsToSend.forEach((c) => {
      c.component.id.serialize(writeStream);
      c.component.data.serialize(writeStream);
    });
    let outboundMessage = this.networkPeer.sendMessage(componentStateMessage, () => {
      this.chooser.onComponentsAcked(componentsToSend);
    });
    if (this.lastOutboundComponentStateMessage !== undefined) {
      this.lastOutboundComponentStateMessage.expire();
    }
    this.lastOutboundComponentStateMessage = outboundMessage;
  }

  private sendDeletionsMessage(currentFrame: SimulationFrameData) {
    let deletionsMessage = new S2C_FrameDeletionsMessage();
    deletionsMessage.simulationFrameIndex = currentFrame.simulationFrameIndex;
    deletionsMessage.simulationTimeS = currentFrame.simulationTimeS;
    for (let component of currentFrame.state.getEntityComponentDb().getAllComponents()) {
      if (component.isDeleted) {
        let maybeDeletedTag = currentFrame.state.getComponent(DeletedTag, component.id.ownerId);
        if (maybeDeletedTag === undefined) {
          // The owning entity is not deleted so add this component.
          // TODO, eliminate the kindId once componentId is a combo of entityId and KindId
          deletionsMessage.deletedComponentIds.push(component.id);
        }
      }
      if ((component.data as {}).constructor === DeletedTag) {
        deletionsMessage.deletedEntityIds.push(component.id.ownerId);
      }
    }
    this.networkPeer.sendMessage(deletionsMessage);
  }
}
