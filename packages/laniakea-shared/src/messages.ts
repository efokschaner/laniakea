import { ComponentId, EntityId } from './ids';
import { SequenceNumber } from './network/sequence-number';
import {
  Serializable,
  SerializationStream,
} from './serialization';

// Allow our message name format
// tslint:disable:class-name

export class S2C_FrameInputsUsedMessage implements Serializable {
  public simulationFrameIndex = -1;
  public simulationTimeS = -1;
  // Difficulty stems from the fact that correct construction
  // of these types depends on having the engine reflection info.
  // We therefore tunnel them as opaque buffers to a layer that has the info.
  // TODO We should try to revise this so that we don't have to do this.
  public inputUsedForPlayerThisFrame!: Uint8Array;
  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'simulationFrameIndex');
    stream.serializeFloat64(this, 'simulationTimeS');
    stream.serializeUint8Array(this, 'inputUsedForPlayerThisFrame');
  }
}

export class S2C_FrameComponentStateMessage implements Serializable {
  public simulationFrameIndex = -1;
  public simulationTimeS = -1;
  // Difficulty stems from the fact that correct construction
  // of these types depends on having the engine reflection info.
  // We therefore tunnel them as opaque buffers to a layer that has the info.
  // TODO We should try to revise this so that we don't have to do this.
  public componentData!: Uint8Array;
  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'simulationFrameIndex');
    stream.serializeFloat64(this, 'simulationTimeS');
    stream.serializeUint8Array(this, 'componentData');
  }
}

function serializeUint32Array(stream: SerializationStream, arr: number[]) {
  let lengthObj = {val: arr.length};
  stream.serializeUint32(lengthObj, 'val');
  let uint8Arr = {val: new Uint8Array(0)};
  if (stream.isWriting) {
    let uint32arr = Uint32Array.from(arr);
    uint8Arr = {val: new Uint8Array(uint32arr.buffer)};
  }
  stream.serializeUint8Array(uint8Arr, 'val');
  if (stream.isReading) {
    arr.length = 0;
    let uint32Arr = new Uint32Array(uint8Arr.val);
    for (let uint32 of uint32Arr) {
      arr.push(uint32);
    }
  }
}

export class S2C_FrameDeletionsMessage implements Serializable {
  public simulationFrameIndex = -1;
  public simulationTimeS = -1;
  // Components of deleted entitys are redundant and therefore are not included in deletedComponentIds
  public deletedComponentIds = new Array<ComponentId>();
  public deletedEntityIds = new Array<EntityId>();

  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'simulationFrameIndex');
    stream.serializeFloat64(this, 'simulationTimeS');
    stream.serializeUint16(this.deletedComponentIds, 'length');
    for (let i = 0; i < this.deletedComponentIds.length; ++i) {
      if (stream.isWriting) {
        this.deletedComponentIds[i].serialize(stream);
      } else {
        let componentId = new ComponentId();
        componentId.serialize(stream);
        this.deletedComponentIds[i] = componentId;
      }
    }
    serializeUint32Array(stream, this.deletedEntityIds);
  }
}

export class C2S_TimeSyncRequestMessage implements Serializable {
  public clientTimeS = 0;
  public serialize(stream: SerializationStream): void {
    stream.serializeFloat64(this, 'clientTimeS');
  }
}

export class S2C_TimeSyncResponseMessage implements Serializable {
  public clientTimeS = 0;
  public serverTimeS = 0;
  public serialize(stream: SerializationStream): void {
    stream.serializeFloat64(this, 'clientTimeS');
    stream.serializeFloat64(this, 'serverTimeS');
  }
}

export class C2S_InputFrameMessage implements Serializable {
  public targetSimulationTimeS = -1;
  public inputFrame!: Uint8Array;
  public sequenceNumber = new SequenceNumber();
  public serialize(stream: SerializationStream): void {
    stream.serializeFloat64(this, 'targetSimulationTimeS');
    stream.serializeUint8Array(this, 'inputFrame');
    this.sequenceNumber.serialize(stream);
  }
}

export function registerMessageTypes(
  registerCb: <T extends Serializable>(
    ctor: new(...args: any[]) => T,
    uniquePacketTypeName: string) => void) {
  registerCb(S2C_FrameInputsUsedMessage, 'S2C_FrameInputsUsedMessage');
  registerCb(S2C_FrameComponentStateMessage, 'S2C_FrameComponentStateMessage');
  registerCb(S2C_FrameDeletionsMessage, 'S2C_FrameDeletionsMessage');
  registerCb(C2S_TimeSyncRequestMessage, 'C2S_TimeSyncRequestMessage');
  registerCb(S2C_TimeSyncResponseMessage, 'S2C_TimeSyncResponseMessage');
  registerCb(C2S_InputFrameMessage, 'C2S_InputFrameMessage');
}
