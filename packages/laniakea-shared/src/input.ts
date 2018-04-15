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
    for(let continuousInputkindId of this.continuousInputTypes.getKindIds()) {
      this.continuousInputs.set(
        continuousInputkindId,
        this.continuousInputTypes.construct(continuousInputkindId, []) as Serializable);
    }
  }

  serialize(stream: SerializationStream): void {
    let numContinuousInputsObj =  {val: this.continuousInputs.size};
    stream.serializeUint32(numContinuousInputsObj, 'val');
    if(stream.isWriting) {
      for(let [kindId, input] of this.continuousInputs.entries()) {
        stream.serializeUint32({kindId}, 'kindId');
        input.serialize(stream);
      }
    } else {
      this.continuousInputs.clear();
      for(let i = 0; i < numContinuousInputsObj.val; ++i) {
        let kindId = {val:0};
        stream.serializeUint32(kindId, 'val');
        let input = this.continuousInputTypes.construct(kindId.val as ContinuousInputKindId, []) as Serializable;
        input.serialize(stream);
        this.continuousInputs.set(kindId.val, input);
      }
    }
  }

  /** returns the object of the requested type, it's mutable to allow the application of inputs */
  public getContinuousInput<T extends Serializable>(inputType: {new():T}): T | undefined {
    let inputKindId = this.continuousInputTypes.getKindIdFromConstructor(inputType);
    if(inputKindId === undefined) {
      return undefined;
    }
    let input = this.continuousInputs.get(inputKindId);
    return input as T | undefined;
  }

}
