// TODO Explore using capnproto to meet our serializion requirements
// Could be used for both component data in memory as well as on the wire
// with some coolness about being able to write our memory representation
// directly to the wire!
// If it looks like its gonna suck to actually define the game using
// capnproto's language, then we can potentially be mad and generate
// our capnproto files from Typescript class defs, so it still feels
// all TS-ish? But the data members would become accessors, so still
// some cognitive burden.... Hmmm

import * as reflection from './class-registry';
import { ShortTypeId } from './class-registry';

export interface Serializable {
  serialize(stream: SerializationStream): void;
}

export type SerializationStream = ReadStream | WriteStream | MeasureStream;

export interface SerializationStreamInterface {
  readonly kind: 'read' | 'write';
  readonly isReading: boolean;
  readonly isWriting: boolean;

  serializeBoolean(value: boolean): boolean;
  serializeUint8(value: number): number;
  serializeUint16(value: number): number;
  serializeUint32(value: number): number;
  serializeInt8(value: number): number;
  serializeInt16(value: number): number;
  serializeInt32(value: number): number;
  serializeFloat32(value: number): number;
  serializeFloat64(value: number): number;
  serializeStringUTF16(value: string): string;
  serializeUint8Array(value: Uint8Array): Uint8Array;
  serializeSerializable(value: Serializable): Serializable;
}

export class ReadStream implements SerializationStreamInterface {
  public readonly kind: 'read' = 'read';
  public readonly isReading = true;
  public readonly isWriting = false;

  private curOffset = 0;
  public constructor(
    private dataView: DataView,
    private classRegistry?: reflection.ClassRegistry<Serializable>
  ) {}

  public getNumBytesRead(): number {
    return this.curOffset;
  }

  public hasMoreData(): boolean {
    return this.curOffset < this.dataView.byteLength;
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
    let stringView = new Uint16Array(
      this.dataView.buffer,
      this.dataView.byteOffset + this.curOffset,
      strLenBytes
    );
    this.curOffset += strLenBytes;
    let result = String.fromCharCode(...stringView);
    return result;
  }
  public readUint8Array(): Uint8Array {
    let buffLenBytes = this.dataView.getUint16(this.curOffset);
    this.curOffset += 2;
    let result = new Uint8Array(
      this.dataView.buffer,
      this.dataView.byteOffset + this.curOffset,
      buffLenBytes
    );
    this.curOffset += buffLenBytes;
    return result;
  }

  public readSerializable(): Serializable {
    if (this.classRegistry === undefined) {
      throw new Error(
        'Can not serialize arbitrary type without a classRegistry.'
      );
    }
    let typeId = this.dataView.getUint16(this.curOffset) as ShortTypeId;
    this.curOffset += 2;
    let result = this.classRegistry
      .getTypeInfoByShortTypeId(typeId)!
      .construct();
    result.serialize(this);
    return result;
  }

  public serializeBoolean(_value: boolean): boolean {
    return this.readBoolean();
  }
  public serializeUint8(_value: number): number {
    return this.readUint8();
  }
  public serializeUint16(_value: number): number {
    return this.readUint16();
  }
  public serializeUint32(_value: number): number {
    return this.readUint32();
  }
  public serializeInt8(_value: number): number {
    return this.readInt8();
  }
  public serializeInt16(_value: number): number {
    return this.readInt16();
  }
  public serializeInt32(_value: number): number {
    return this.readInt32();
  }
  public serializeFloat32(_value: number): number {
    return this.readFloat32();
  }
  public serializeFloat64(_value: number): number {
    return this.readFloat64();
  }
  public serializeStringUTF16(_value: string): string {
    return this.readStringUTF16();
  }
  public serializeUint8Array(_value: Uint8Array): Uint8Array {
    return this.readUint8Array();
  }
  public serializeSerializable(_value: Serializable): Serializable {
    return this.readSerializable();
  }
}

export class WriteStream implements SerializationStreamInterface {
  public readonly kind: 'write' = 'write';
  public readonly isReading = false;
  public readonly isWriting = true;

  private curOffset = 0;

  public getNumBytesWritten(): number {
    return this.curOffset;
  }

  /**
   * @param dataView
   * @param classRegistry optional, only required for serialization of variant types.
   */
  public constructor(
    private dataView: DataView,
    private classRegistry?: reflection.ClassRegistry<Serializable>
  ) {}

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
    if (strLenBytes >= 2 ** 8) {
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
    if (buffLenBytes >= 2 ** 16) {
      throw new Error("Don't serialize such a large buffer...");
    }
    this.dataView.setUint16(this.curOffset, buffLenBytes);
    this.curOffset += 2;
    let buffView = new Uint8Array(
      this.dataView.buffer,
      this.dataView.byteOffset + this.curOffset,
      buffLenBytes
    );
    buffView.set(value);
    this.curOffset += buffLenBytes;
  }

  public writeSerializable(value: Serializable): void {
    if (this.classRegistry === undefined) {
      throw new Error(
        'Can not serialize arbitrary type without a classRegistry.'
      );
    }
    let typeId = this.classRegistry.getTypeInfoByConstructor(
      value.constructor as reflection.Constructor<Serializable>
    )!.shortTypeId;
    this.dataView.setUint16(this.curOffset, typeId);
    this.curOffset += 2;
    value.serialize(this);
  }

  public serializeBoolean(value: boolean): boolean {
    this.writeBoolean(value);
    return value;
  }
  public serializeUint8(value: number): number {
    this.writeUint8(value);
    return value;
  }
  public serializeUint16(value: number): number {
    this.writeUint16(value);
    return value;
  }
  public serializeUint32(value: number): number {
    this.writeUint32(value);
    return value;
  }
  public serializeInt8(value: number): number {
    this.writeInt8(value);
    return value;
  }
  public serializeInt16(value: number): number {
    this.writeInt16(value);
    return value;
  }
  public serializeInt32(value: number): number {
    this.writeInt32(value);
    return value;
  }
  public serializeFloat32(value: number): number {
    this.writeFloat32(value);
    return value;
  }
  public serializeFloat64(value: number): number {
    this.writeFloat64(value);
    return value;
  }
  public serializeStringUTF16(value: string): string {
    this.writeStringUTF16(value);
    return value;
  }
  public serializeUint8Array(value: Uint8Array): Uint8Array {
    this.writeUint8Array(value);
    return value;
  }
  public serializeSerializable(value: Serializable): Serializable {
    this.writeSerializable(value);
    return value;
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

  public writeBoolean(_value: boolean): void {
    this.curOffset += 1;
  }

  public writeUint8(_value: number): void {
    this.curOffset += 1;
  }
  public writeUint16(_value: number): void {
    this.curOffset += 2;
  }
  public writeUint32(_value: number): void {
    this.curOffset += 4;
  }

  public writeInt8(_value: number): void {
    this.curOffset += 1;
  }
  public writeInt16(_value: number): void {
    this.curOffset += 2;
  }
  public writeInt32(_value: number): void {
    this.curOffset += 4;
  }

  public writeFloat32(_value: number): void {
    this.curOffset += 4;
  }
  public writeFloat64(_value: number): void {
    this.curOffset += 8;
  }

  public writeStringUTF16(value: string): void {
    let strLenBytes = value.length * 2;
    if (strLenBytes >= 2 ** 8) {
      throw new Error("Don't serialize such a large string...");
    }
    this.curOffset += 1;
    this.curOffset += strLenBytes;
  }
  public writeUint8Array(value: Uint8Array): void {
    let buffLenBytes = value.length;
    if (buffLenBytes >= 2 ** 16) {
      throw new Error("Don't serialize such a large buffer...");
    }
    this.curOffset += 2;
    this.curOffset += buffLenBytes;
  }

  public writeSerializable(value: Serializable): void {
    this.curOffset += 2;
    value.serialize(this);
  }

  public serializeBoolean(value: boolean): boolean {
    this.writeBoolean(value);
    return value;
  }
  public serializeUint8(value: number): number {
    this.writeUint8(value);
    return value;
  }
  public serializeUint16(value: number): number {
    this.writeUint16(value);
    return value;
  }
  public serializeUint32(value: number): number {
    this.writeUint32(value);
    return value;
  }
  public serializeInt8(value: number): number {
    this.writeInt8(value);
    return value;
  }
  public serializeInt16(value: number): number {
    this.writeInt16(value);
    return value;
  }
  public serializeInt32(value: number): number {
    this.writeInt32(value);
    return value;
  }
  public serializeFloat32(value: number): number {
    this.writeFloat32(value);
    return value;
  }
  public serializeFloat64(value: number): number {
    this.writeFloat64(value);
    return value;
  }
  public serializeStringUTF16(value: string): string {
    this.writeStringUTF16(value);
    return value;
  }
  public serializeUint8Array(value: Uint8Array): Uint8Array {
    this.writeUint8Array(value);
    return value;
  }
  public serializeSerializable(value: Serializable): Serializable {
    this.writeSerializable(value);
    return value;
  }
}

export function measureSerializable(obj: Serializable): number {
  let measureStream = new MeasureStream();
  obj.serialize(measureStream);
  return measureStream.getNumBytesWritten();
}

export function measureAndSerialize(
  obj: Serializable,
  classRegistry?: reflection.ClassRegistry<Serializable>
): ArrayBuffer {
  let measureStream = new MeasureStream();
  obj.serialize(measureStream);
  let writeBuffer = new ArrayBuffer(measureStream.getNumBytesWritten());
  let writeStream = new WriteStream(new DataView(writeBuffer), classRegistry);
  obj.serialize(writeStream);
  return writeBuffer;
}

/* Sketch for SerializableMap class
TODO because we need some kind of uniform support for class and non-class serialization
That uniform support could look like this:

let object;
object = serialize<SomeClass>(object);
let primitive;
primitive = serialize<SomePrimitive>(primitive);

// If this is a serialization it returns the passed value
// If this is a deserialization it returns the value read from the buffer
  // If the value is primitive, thats a new value
  // If the value is an object, it recyles the passed object and returns it.

Also maybe Serializable can be 2 interfaces, 1 for purely staticly known types, requires no RTTI and 1 for dynamic types that requires RTTI.

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
