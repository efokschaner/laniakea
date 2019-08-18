import { ClassRegistry, ShortTypeId, TypeInfo, TypeId } from './class-registry';
import { Serializable, SerializationStream } from './serialization';


export class InputFrame implements Serializable {
  private continuousInputs = new Map<TypeId, Serializable>();

  constructor(
    private continuousInputTypes: Array<TypeInfo>,
    private classRegistry: ClassRegistry) {
    for (let continuousInputType of this.continuousInputTypes) {
      this.continuousInputs.set(
        continuousInputType.typeId,
        continuousInputType.construct() as Serializable);
    }
  }

  public serialize(stream: SerializationStream): void {
    if (stream.isWriting) {
      stream.writeUint16(this.continuousInputs.size);
      for (let [typeId, input] of this.continuousInputs.entries()) {
        stream.writeUint16(this.classRegistry.getTypeInfoByTypeId(typeId)!.shortTypeId);
        input.serialize(stream);
      }
    } else {
      this.continuousInputs.clear();
      let numContinuousInputs = stream.readUint16();
      for (let i = 0; i < numContinuousInputs; ++i) {
        let shortTypeId = stream.readUint16() as ShortTypeId;
        let typeInfo = this.classRegistry.getTypeInfoByShortTypeId(shortTypeId)!;
        let input = typeInfo.construct() as Serializable;
        input.serialize(stream);
        this.continuousInputs.set(typeInfo.typeId, input);
      }
    }
  }

  /**
   * Returns the object of the requested type, it's mutable to allow the application of inputs
   */
  public getContinuousInput<T extends Serializable>(inputType: new() => T): T | undefined {
    let inputTypeInfo = this.classRegistry.getTypeInfoByConstructor(inputType);
    if (inputTypeInfo === undefined) {
      return undefined;
    }
    let input = this.continuousInputs.get(inputTypeInfo.typeId);
    return input as T | undefined;
  }

}
