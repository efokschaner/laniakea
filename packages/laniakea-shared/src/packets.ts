import {
  Serializable,
  SerializationStream
} from './serialization';

export class S2C_FrameUpdatePacket implements Serializable {
  public simulationFrameIndex = -1;
  public simulationTimeS = -1;
  public downButtons = new Set<number>();
  public componentData!: Uint8Array;

  serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'simulationFrameIndex');
    stream.serializeFloat64(this, 'simulationTimeS');
    serializeSetOfUint8(stream, this.downButtons);
    stream.serializeUint8Array(this, 'componentData');
  }
}

export class C2S_TimeSyncRequestPacket implements Serializable {
  public clientTimeS = 0;
  serialize(stream: SerializationStream): void {
    stream.serializeFloat64(this, 'clientTimeS');
  }
}

export class S2C_TimeSyncResponsePacket implements Serializable {
  public clientTimeS = 0;
  public serverTimeS = 0;
  serialize(stream: SerializationStream): void {
    stream.serializeFloat64(this, 'clientTimeS');
    stream.serializeFloat64(this, 'serverTimeS');
  }
}

export class C2S_InputFramePacket implements Serializable {
  public targetSimulationTimeS = -1;
  /**
   * Buttons in the down state are sent, other buttons are assumed to be in the up state.
   */
  public downButtons = new Set<number>();
  serialize(stream: SerializationStream): void {
    stream.serializeFloat64(this, 'targetSimulationTimeS');
    serializeSetOfUint8(stream, this.downButtons);
  }
}

export function registerPacketTypes(
  registerCb: <T extends Serializable>(
    ctor: {new(...args: any[]):T},
    uniquePacketTypeName: string) => void) {
  registerCb(S2C_FrameUpdatePacket, 'S2C_FrameUpdatePacket');
  registerCb(C2S_TimeSyncRequestPacket, 'C2S_TimeSyncRequestPacket');
  registerCb(S2C_TimeSyncResponsePacket, 'S2C_TimeSyncResponsePacket');
  registerCb(C2S_InputFramePacket, 'C2S_InputFramePacket');
}

function serializeSetOfUint8(stream: SerializationStream, set: Set<number>): void {
  let numEntries = {val:0};
  if(stream.isWriting) {
    numEntries.val = set.size;
  }
  stream.serializeUint8(numEntries, 'val');
  if(stream.isWriting) {
    for(let number of set.values()) {
      let numberObj = { number };
      stream.serializeUint8(numberObj, 'number');
    }
  } else {
    set.clear();
    for(let i = 0; i < numEntries.val; ++i) {
      let numberObj = { number: 0 };
      stream.serializeUint8(numberObj, 'number');
      set.add(numberObj.number);
    }
  }
}