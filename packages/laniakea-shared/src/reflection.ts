import * as XXH from 'xxhashjs';

const XXHASH_SEED = 0;

// Trick to get nominally typed Id types
// https://basarat.gitbooks.io/typescript/docs/tips/nominalTyping.html
export enum _KindBrand {}
export enum _KindIdBrand {}

export type Kind = string & _KindBrand;
export type KindId = number & _KindIdBrand;

export interface GenericConstructor { new(...args: any[]): {}; }

export class ClassRegistry {
  public getKindId(kind: Kind): KindId {
    return XXH.h32(kind, XXHASH_SEED).toNumber();
  }
  public getKindIdFromConstructor(ctor: GenericConstructor) {
    return this.constructorToKindId.get(ctor);
  }
  public getKind(kindId: KindId): Kind | undefined {
    return this.kindIdToKind.get(kindId);
  }
  public getKindIds(): Iterable<KindId> {
    return this.kindIdToKind.keys();
  }
  public registerClass(ctor: GenericConstructor, kind: string): KindId {
    let kindId = this.getKindId(kind as Kind);
    if (this.kindIdToKind.has(kindId)) {
      throw new Error('Key Collision');
    }
    this.kindIdToKind.set(kindId, kind as Kind);
    this.constructorToKindId.set(ctor, kindId);
    this.kindIdToConstructor.set(kindId, ctor);
    return kindId;
  }
  public construct(kindId: KindId, ctorArgs: any[]) {
    return new (this.kindIdToConstructor.get(kindId)!) (...ctorArgs);
  }
  private kindIdToKind: Map<KindId, Kind> = new Map();
  private constructorToKindId: Map<GenericConstructor, KindId> = new Map();
  private kindIdToConstructor: Map<KindId, GenericConstructor> = new Map();
}
