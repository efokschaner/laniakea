// TODO Explore using capnproto to meet our serializion requirements
// Could be used for both component data in memory as well as on the wire
// with some coolness about being able to write our memory representation
// directly to the wire!
// If it looks like its gonna suck to actually define the game using
// capnproto's language, then we can potentially be mad and generate
// our capnproto files from Typescript class defs, so it still feels
// all TS-ish? But the data members would become accessors, so still
// some cognitive burden.... Hmmm

import * as reflection from './reflection';

export interface Serializable {
  serialize(stream: SerializationStream): void;
}

export type SerializationStream = ReadStream | WriteStream | MeasureStream;

export interface SerializationStreamInterface {
  readonly kind: 'read'|'write';
  readonly isReading: boolean;
  readonly isWriting: boolean;

  serializeBoolean<T extends {[k in K]: boolean} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;

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

  serializeSerializable<T extends {[k in K]: Serializable} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void;
}

export class ReadStream implements SerializationStreamInterface {
  public readonly kind: 'read' = 'read';
  public readonly isReading = true;
  public readonly isWriting = false;

  private curOffset = 0;
  constructor(private dataView: DataView, private classRegistry?: reflection.ClassRegistry) {
  }

  public readBoolean(): boolean {
    let result = this.dataView.getUint8(this.curOffset) > 0;
    this.curOffset += 1;
    return result;
  }

  public readUint8(): number {
    let result = this.dataView.getUint8(this.curOffset);
    this.curOffset += 1;
    return result;
  }
  public readUint16(): number {
    let result = this.dataView.getUint16(this.curOffset);
    this.curOffset += 2;
    return result;
  }
  public readUint32(): number {
    let result = this.dataView.getUint32(this.curOffset);
    this.curOffset += 4;
    return result;
  }

  public readInt8(): number {
    let result = this.dataView.getInt8(this.curOffset);
    this.curOffset += 1;
    return result;
  }
  public readInt16(): number {
    let result = this.dataView.getInt16(this.curOffset);
    this.curOffset += 2;
    return result;
  }
  public readInt32(): number {
    let result = this.dataView.getInt32(this.curOffset);
    this.curOffset += 4;
    return result;
  }

  public readFloat32(): number {
    let result = this.dataView.getFloat32(this.curOffset);
    this.curOffset += 4;
    return result;
  }
  public readFloat64(): number {
    let result = this.dataView.getFloat64(this.curOffset);
    this.curOffset += 8;
    return result;
  }

  public readStringUTF16(): string {
    let strLenBytes = this.dataView.getUint8(this.curOffset);
    this.curOffset += 1;
    let stringView = new Uint16Array(this.dataView.buffer, this.dataView.byteOffset + this.curOffset, strLenBytes);
    this.curOffset += strLenBytes;
    let result = String.fromCharCode(...stringView);
    return result;
  }
  public readUint8Array(): Uint8Array {
    let buffLenBytes = this.dataView.getUint16(this.curOffset);
    this.curOffset += 2;
    let result = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.curOffset, buffLenBytes);
    this.curOffset += buffLenBytes;
    return result;
  }

  public readSerializable(): Serializable {
    if (this.classRegistry === undefined) {
      throw new Error('Can not serialize arbitrary type without a classRegistry.');
    }
    let kindId = this.dataView.getUint32(this.curOffset);
    this.curOffset += 4;
    let result = this.classRegistry.construct(kindId, []) as Serializable;
    result.serialize(this);
    return result;
  }

  public serializeBoolean<T extends {[k in K]: boolean} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readBoolean();
  }

  public serializeUint8<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readUint8();
  }
  public serializeUint16<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readUint16();
  }
  public serializeUint32<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readUint32();
  }

  public serializeInt8<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readInt8();
  }
  public serializeInt16<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readInt16();
  }
  public serializeInt32<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readInt32();
  }

  public serializeFloat32<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readFloat32();
  }
  public serializeFloat64<T extends {[k in K]?: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readFloat64();
  }

  public serializeStringUTF16<T extends {[k in K]?: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readStringUTF16();
  }
  public serializeUint8Array<T extends {[k in K]?: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readUint8Array();
  }

  public serializeSerializable<T extends {[k in K]?: Serializable} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    obj[key] = this.readSerializable();
  }
}

export class WriteStream implements SerializationStreamInterface {
  public readonly kind: 'write' = 'write';
  public readonly isReading = false;
  public readonly isWriting = true;

  private curOffset = 0;
  // classRegistry is optional, only required for serialisation of non-builtin types.
  constructor(private dataView: DataView, private classRegistry?: reflection.ClassRegistry) {
  }

  public writeBoolean(value: boolean): void {
    this.dataView.setUint8(this.curOffset, value ? 1 : 0);
    this.curOffset += 1;
  }

  public writeUint8(value: number): void {
    this.dataView.setUint8(this.curOffset, value);
    this.curOffset += 1;
  }
  public writeUint16(value: number): void {
    this.dataView.setUint16(this.curOffset, value);
    this.curOffset += 2;
  }
  public writeUint32(value: number): void {
    this.dataView.setUint32(this.curOffset, value);
    this.curOffset += 4;
  }

  public writeInt8(value: number): void {
    this.dataView.setInt8(this.curOffset, value);
    this.curOffset += 1;
  }
  public writeInt16(value: number): void {
    this.dataView.setInt16(this.curOffset, value);
    this.curOffset += 2;
  }
  public writeInt32(value: number): void {
    this.dataView.setInt32(this.curOffset, value);
    this.curOffset += 4;
  }

  public writeFloat32(value: number): void {
    this.dataView.setFloat32(this.curOffset, value);
    this.curOffset += 4;
  }
  public writeFloat64(value: number): void {
    this.dataView.setFloat64(this.curOffset, value);
    this.curOffset += 8;
  }

  public writeStringUTF16(value: string): void {
    let strLenBytes = value.length * 2;
    // tslint:disable-next-line:no-bitwise
    if (strLenBytes >= 1 << 8) {
      throw new Error("Don't serialize such a large string...");
    }
    this.dataView.setUint8(this.curOffset, strLenBytes);
    this.curOffset += 1;
    for (let i = 0, len = value.length; i < len; i++) {
      this.dataView.setUint16(this.curOffset, value.charCodeAt(i));
      this.curOffset += 2;
    }
  }
  public writeUint8Array(value: Uint8Array): void {
    let buffLenBytes = value.length;
    // tslint:disable-next-line:no-bitwise
    if (buffLenBytes >= 1 << 16) {
      throw new Error("Don't serialize such a large buffer...");
    }
    this.dataView.setUint16(this.curOffset, buffLenBytes);
    this.curOffset += 2;
    let buffView = new Uint8Array(this.dataView.buffer, this.dataView.byteOffset + this.curOffset, buffLenBytes);
    buffView.set(value);
    this.curOffset += buffLenBytes;
  }

  public writeSerializable(value: Serializable): void {
    if (this.classRegistry === undefined) {
      throw new Error('Can not serialize arbitrary type without a classRegistry.');
    }
    let kindId = this.classRegistry.getKindIdFromConstructor(value.constructor as reflection.GenericConstructor)!;
    this.dataView.setUint32(this.curOffset, kindId);
    this.curOffset += 4;
    value.serialize(this);
  }

  public serializeBoolean<T extends {[k in K]: boolean} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeBoolean(obj[key]);
  }

  public serializeUint8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint8(obj[key]);
  }
  public serializeUint16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint16(obj[key]);
  }
  public serializeUint32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint32(obj[key]);
  }

  public serializeInt8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeInt8(obj[key]);
  }
  public serializeInt16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeInt16(obj[key]);
  }
  public serializeInt32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeInt32(obj[key]);
  }

  public serializeFloat32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeFloat32(obj[key]);
  }
  public serializeFloat64<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeFloat64(obj[key]);
  }

  public serializeStringUTF16<T extends {[k in K]: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeStringUTF16(obj[key]);
  }
  public serializeUint8Array<T extends {[k in K]: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint8Array(obj[key]);
  }

  public serializeSerializable<T extends {[k in K]: Serializable} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeSerializable(obj[key]);
  }
}

export class MeasureStream implements SerializationStreamInterface {
  public readonly kind: 'write' = 'write'; // Want the writer to behave exactly as they would if they were writing.
  public readonly isReading = false;
  public readonly isWriting = true;

  private curOffset = 0;

  public getNumBytesWritten(): number {
    return this.curOffset;
  }

  public writeBoolean(value: boolean): void {
    this.curOffset += 1;
  }

  public writeUint8(value: number): void {
    this.curOffset += 1;
  }
  public writeUint16(value: number): void {
    this.curOffset += 2;
  }
  public writeUint32(value: number): void {
    this.curOffset += 4;
  }

  public writeInt8(value: number): void {
    this.curOffset += 1;
  }
  public writeInt16(value: number): void {
    this.curOffset += 2;
  }
  public writeInt32(value: number): void {
    this.curOffset += 4;
  }

  public writeFloat32(value: number): void {
    this.curOffset += 4;
  }
  public writeFloat64(value: number): void {
    this.curOffset += 8;
  }

  public writeStringUTF16(value: string): void {
    let strLenBytes = value.length * 2;
    // tslint:disable-next-line:no-bitwise
    if (strLenBytes >= 1 << 8) {
      throw new Error("Don't serialize such a large string...");
    }
    this.curOffset += 1;
    this.curOffset += strLenBytes;
  }
  public writeUint8Array(value: Uint8Array): void {
    let buffLenBytes = value.length;
    // tslint:disable-next-line:no-bitwise
    if (buffLenBytes >= 1 << 16) {
      throw new Error("Don't serialize such a large buffer...");
    }
    this.curOffset += 2;
    this.curOffset += buffLenBytes;
  }

  public writeSerializable(value: Serializable): void {
    this.curOffset += 4;
    value.serialize(this);
  }

  public serializeBoolean<T extends {[k in K]: boolean} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeBoolean(obj[key]);
  }

  public serializeUint8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint8(obj[key]);
  }
  public serializeUint16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint16(obj[key]);
  }
  public serializeUint32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint32(obj[key]);
  }

  public serializeInt8<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeInt8(obj[key]);
  }
  public serializeInt16<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeInt16(obj[key]);
  }
  public serializeInt32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeInt32(obj[key]);
  }

  public serializeFloat32<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeFloat32(obj[key]);
  }
  public serializeFloat64<T extends {[k in K]: number} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeFloat64(obj[key]);
  }

  public serializeStringUTF16<T extends {[k in K]: string} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeStringUTF16(obj[key]);
  }
  public serializeUint8Array<T extends {[k in K]: Uint8Array} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeUint8Array(obj[key]);
  }

  public serializeSerializable<T extends {[k in K]: Serializable} & {[k: string]: any}, K extends keyof T>(obj: T, key: K): void {
    this.writeSerializable(obj[key]);
  }
}

export function measureAndSerialize(obj: Serializable, classRegistry?: reflection.ClassRegistry): ArrayBuffer {
  let measureStream = new MeasureStream();
  obj.serialize(measureStream);
  let writeBuffer = new ArrayBuffer(measureStream.getNumBytesWritten());
  let writeStream = new WriteStream(new DataView(writeBuffer), classRegistry);
  obj.serialize(writeStream);
  return writeBuffer;
}

/* Sketch for SerializableMap class
TODO because we need some kind of uniform support for class and non-class serialization

export class SerializableMap<K, V> extends Map<K, V> implements Serializable {
  constructor(
    keySerializeCb: keyof SerializationStream,
    valueSerializeCb: keyof SerializationStream,
  ) {
   super();
  }

  serialize(stream: SerializationStream): void {
    let numEntries = {val:0};
    if(stream.isWriting) {
      numEntries.val = this.size;
    }
    stream.serializeUint32(numEntries, 'val');
    if(stream.isWriting) {
      for(let [key, value] of this.entries()) {
        stream[this.key]
      }
    } else {
      for(let i = 0; i < numEntries.val; ++i) {
      }
    }
  }
}
*/
