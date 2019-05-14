import { ClassRegistry } from './reflection';
import { Serializable, SerializationStream } from './serialization';

// Trick to get nominally typed Id types
// https://basarat.gitbooks.io/typescript/docs/tips/nominalTyping.html

export enum _ContinuousInputKindBrand {}
export type ContinuousInputKind = string & _ContinuousInputKindBrand;

export enum _ContinuousInputKindIdBrand {}
export type ContinuousInputKindId = number & _ContinuousInputKindIdBrand;

export enum _EventedInputKindBrand {}
export type EventedInputKind = string & _EventedInputKindBrand;

export enum _EventedInputKindIdBrand {}
export type EventedInputKindId = number & _EventedInputKindIdBrand;

export class InputFrame implements Serializable {
  private continuousInputs = new Map<ContinuousInputKindId, Serializable>();

  constructor(private continuousInputTypes: ClassRegistry) {
    for (let continuousInputkindId of this.continuousInputTypes.getKindIds()) {
      this.continuousInputs.set(
        continuousInputkindId,
        this.continuousInputTypes.construct(continuousInputkindId, []) as Serializable);
    }
  }

  public serialize(stream: SerializationStream): void {
    if (stream.isWriting) {
      stream.writeUint32(this.continuousInputs.size);
      for (let [kindId, input] of this.continuousInputs.entries()) {
        stream.writeInt32(kindId);
        input.serialize(stream);
      }
    } else {
      this.continuousInputs.clear();
      let numContinuousInputs = stream.readUint32();
      for (let i = 0; i < numContinuousInputs; ++i) {
        let kindId = stream.readUint32();
        let input = this.continuousInputTypes.construct(kindId as ContinuousInputKindId, []) as Serializable;
        input.serialize(stream);
        this.continuousInputs.set(kindId, input);
      }
    }
  }

  /** returns the object of the requested type, it's mutable to allow the application of inputs */
  public getContinuousInput<T extends Serializable>(inputType: new() => T): T | undefined {
    let inputKindId = this.continuousInputTypes.getKindIdFromConstructor(inputType);
    if (inputKindId === undefined) {
      return undefined;
    }
    let input = this.continuousInputs.get(inputKindId);
    return input as T | undefined;
  }

}
