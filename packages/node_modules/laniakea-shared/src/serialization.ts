// TODO Explore using capnproto to meet our serializion requirements
// Could be used for both component data in memory as well as on the wire
// with some coolness about being able to write our memory representation
// directly to the wire!
// If it looks like its gonna suck to actually define the game using
// capnproto's language, then we can potentially be mad and generate
// our capnproto files from Typescript class defs, so it still feels
// all TS-ish? But the data members would become accessors, so still
// some cognitive burden.... Hmmm

export interface SerializationStream {
  readonly isReading: boolean;
  readonly isWriting: boolean;

  serializeUint8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
  serializeUint16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
  serializeUint32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;

  serializeInt8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
  serializeInt16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
  serializeInt32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;

  serializeFloat32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
  serializeFloat64<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;

  serializeStringUTF16<T extends {[k in K]: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
  serializeUint8Array<T extends {[k in K]: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
}

export class ReadStream implements SerializationStream {
  readonly isReading = true;
  readonly isWriting = false;

  private curOffset = 0;
  constructor(private dataView: DataView) {
  }

  serializeUint8<T extends {[k in K]: number} & {[others: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getUint8(this.curOffset);
    this.curOffset += 1;
  }
  serializeUint16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getUint16(this.curOffset);
    this.curOffset += 2;
  }
  serializeUint32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getUint32(this.curOffset);
    this.curOffset += 4;
  }

  serializeInt8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getInt8(this.curOffset);
    this.curOffset += 1;
  }
  serializeInt16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getInt16(this.curOffset);
    this.curOffset += 2;
  }
  serializeInt32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getInt32(this.curOffset);
    this.curOffset += 4;
  }

  serializeFloat32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getFloat32(this.curOffset);
    this.curOffset += 4;
  }
  serializeFloat64<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.dataView.getFloat64(this.curOffset);
    this.curOffset += 8;
  }

  serializeStringUTF16<T extends {[k in K]: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    let strLenBytes = this.dataView.getUint8(this.curOffset);
    this.curOffset += 1;
    let stringView = new Uint16Array(this.dataView.buffer, this.dataView.byteOffset + this.curOffset, strLenBytes);
    this.curOffset += strLenBytes;
    obj[key] = String.fromCharCode(...stringView);
  }
  serializeUint8Array<T extends {[k in K]: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    let buffLenBytes = this.dataView.getUint16(this.curOffset);
    this.curOffset += 2;
    let buffView = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.curOffset, buffLenBytes);
    this.curOffset += buffLenBytes;
    obj[key] = buffView;
  }
}

export class WriteStream implements SerializationStream {
  readonly isReading = false;
  readonly isWriting = true;

  private curOffset = 0;
  constructor(private dataView: DataView) {
  }

  serializeUint8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setUint8(this.curOffset, obj[key]);
    this.curOffset += 1;
  }
  serializeUint16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setUint16(this.curOffset, obj[key]);
    this.curOffset += 2;
  }
  serializeUint32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setUint32(this.curOffset, obj[key]);
    this.curOffset += 4;
  }

  serializeInt8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setInt8(this.curOffset, obj[key]);
    this.curOffset += 1;
  }
  serializeInt16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setInt16(this.curOffset, obj[key]);
    this.curOffset += 2;
  }
  serializeInt32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setInt32(this.curOffset, obj[key]);
    this.curOffset += 4;
  }

  serializeFloat32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setFloat32(this.curOffset, obj[key]);
    this.curOffset += 4;
  }
  serializeFloat64<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.dataView.setFloat64(this.curOffset, obj[key]);
    this.curOffset += 8;
  }

  serializeStringUTF16<T extends {[k in K]: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    let str = obj[key] as string; // Don't ask about this cast. Try removing it and see the insanity (at least in TS 2.3.4).
    let strLenBytes = str.length * 2;
    if(strLenBytes >= 2 << 8) {
      throw new Error("Don't serialize such a large string...");
    }
    this.dataView.setUint8(this.curOffset, strLenBytes);
    this.curOffset += 1;
    for(let i = 0, len = str.length; i < len; i++) {
      this.dataView.setUint16(this.curOffset, str.charCodeAt(i));
      this.curOffset += 2;
    }
  }
  serializeUint8Array<T extends {[k in K]: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    let buff = obj[key] as Uint8Array; // Don't ask about this cast. Try removing it and see the insanity (at least in TS 2.3.4).
    let buffLenBytes = buff.length;
    if(buffLenBytes >= 2 << 16) {
      throw new Error("Don't serialize such a large buffer...");
    }
    this.dataView.setUint16(this.curOffset, buffLenBytes);
    this.curOffset += 2;
    let buffView = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.curOffset, buffLenBytes);
    buffView.set(buff);
    this.curOffset += buffLenBytes;
  }
}

export class MeasureStream implements SerializationStream {
  readonly isReading = false;
  readonly isWriting = true; // Want the writer to behave exactly as they would if they were writing.

  private curOffset = 0;
  constructor() {
  }

  getNumBytesWritten(): number {
    return this.curOffset;
  }

  serializeUint8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 1;
  }
  serializeUint16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 2;
  }
  serializeUint32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 4;
  }

  serializeInt8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 1;
  }
  serializeInt16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 2;
  }
  serializeInt32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 4;
  }

  serializeFloat32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 4;
  }
  serializeFloat64<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.curOffset += 8;
  }

  serializeStringUTF16<T extends {[k in K]: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    let str = obj[key] as string;  // Don't ask about this cast. Try removing it and see the insanity (at least in TS 2.3.4).
    let strLenBytes = str.length * 2;
    if(strLenBytes >= 2 << 8) {
      throw new Error("Don't serialize such a large string...");
    }
    this.curOffset += 1;
    for(let i = 0, len = str.length; i < len; i++) {
      this.curOffset += 2;
    }
  }
  serializeUint8Array<T extends {[k in K]: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    let buff = obj[key] as Uint8Array;  // Don't ask about this cast. Try removing it and see the insanity (at least in TS 2.3.4).
    let buffLenBytes = buff.length;
    if(buffLenBytes >= 2 << 16) {
      throw new Error("Don't serialize such a large buffer...");
    }
    this.curOffset += 2;
    this.curOffset += buffLenBytes;
  }
}

export interface Serializable {
  serialize(stream: SerializationStream): void;
}

// TODO possibly unneeded?
export function isSerializable(arg: {}): arg is Serializable {
  return (arg as Serializable).serialize !== undefined;
}

export function measureAndSerialize(obj: Serializable): ArrayBuffer {
  let measureStream = new MeasureStream();
  obj.serialize(measureStream);
  let writeBuffer = new ArrayBuffer(measureStream.getNumBytesWritten());
  let writeStream = new WriteStream(new DataView(writeBuffer));
  obj.serialize(writeStream);
  return writeBuffer;
}