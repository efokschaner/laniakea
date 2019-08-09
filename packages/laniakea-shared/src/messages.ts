import {
  Serializable,
  SerializationStream,
} from './serialization';
import { SequenceNumber } from './network/sequence-number';

// Allow our message name format
// tslint:disable:class-name

export class S2C_FrameUpdateMessage implements Serializable {
  public simulationFrameIndex = -1;
  public simulationTimeS = -1;
  // Difficulty stems from the fact that correct construction
  // of these types depends on having the engine reflection info.
  // We therefore tunnel them as opaque buffers to a layer that has the info.
  // TODO We should try to revise this so that we don't have to do this.
  public inputUsedForPlayerThisFrame!: Uint8Array;
  public componentData!: Uint8Array;

  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'simulationFrameIndex');
    stream.serializeFloat64(this, 'simulationTimeS');
    stream.serializeUint8Array(this, 'inputUsedForPlayerThisFrame');
    stream.serializeUint8Array(this, 'componentData');
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
  registerCb(S2C_FrameUpdateMessage, 'S2C_FrameUpdateMessage');
  registerCb(C2S_TimeSyncRequestMessage, 'C2S_TimeSyncRequestMessage');
  registerCb(S2C_TimeSyncResponseMessage, 'S2C_TimeSyncResponseMessage');
  registerCb(C2S_InputFrameMessage, 'C2S_InputFrameMessage');
}
