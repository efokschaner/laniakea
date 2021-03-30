import * as XXH from 'xxhashjs';
import { NominalType } from './nominal-type';

const XXHASH_SEED = 0;

/**
 * A long type id that is computable from the typename
 * 64-bit hash
 */
export type TypeId = NominalType<number, 'TypeId'>;

/**
 * A short typeId that's better for network message size but requires a lookup in the ClassRegistry
 * 16-bit sequential id
 */
export type ShortTypeId = NominalType<number, 'ShortTypeId'>;

export let MAX_SHORT_TYPE_ID_EXCLUSIVE = 2 ** 16;

/**
 * The human readable name of the type, must be globally unique.
 */
export type TypeName = string;

export type Constructor<T> = new (...args: any[]) => T;

export class TypeInfo<T> {
  public constructor(
    public typeId: TypeId,
    public shortTypeId: ShortTypeId,
    public typeName: TypeName,
    public konstructor: Constructor<T>
  ) {}

  public construct(...args: any[]): T {
    return new this.konstructor(...args);
  }
}

export class ClassRegistry<T> {
  public static getTypeIdFromTypeName(typeName: TypeName): TypeId {
    return XXH.h32(typeName, XXHASH_SEED).toNumber() as TypeId;
  }

  public getTypeInfoByTypeId(typeId: TypeId): TypeInfo<T> | undefined {
    return this.typeIdToTypeInfo.get(typeId);
  }

  public getTypeInfoByShortTypeId(
    shortTypeId: ShortTypeId
  ): TypeInfo<T> | undefined {
    return this.shortTypeIdToTypeInfo[shortTypeId];
  }

  public getTypeInfoByTypeName(typeName: TypeName): TypeInfo<T> | undefined {
    return this.typeIdToTypeInfo.get(
      ClassRegistry.getTypeIdFromTypeName(typeName)
    );
  }

  public getTypeInfoByConstructor(
    konstructor: Constructor<T>
  ): TypeInfo<T> | undefined {
    return this.constructorToTypeInfo.get(konstructor);
  }

  public registerClass(
    konstructor: Constructor<T>,
    typeName: TypeName
  ): TypeInfo<T> {
    let shortTypeId = this.shortTypeIdToTypeInfo.length as ShortTypeId;
    if (shortTypeId >= MAX_SHORT_TYPE_ID_EXCLUSIVE) {
      throw new Error('shortTypeId would exceed max size (2^16 - 1)');
    }
    return this.registerClassWithShortId(konstructor, typeName, shortTypeId);
  }

  /**
   * Dump the entire type mapping to allow us to send it to others
   */
  public getTypeIdToShortTypeIdMapping(): Array<[TypeId, ShortTypeId]> {
    return Array.from(this.typeIdToTypeInfo.entries()).map(([t, info]) => [
      t,
      info.shortTypeId,
    ]);
  }

  /**
   * Receive the dumped mapping and overwrite our mapping with it.
   */
  public setTypeIdToShortTypeIdMapping(
    mapping: Array<[TypeId, ShortTypeId]>
  ): void {
    this.shortTypeIdToTypeInfo = new Array<TypeInfo<T>>();
    for (let [typeId, shortTypeId] of mapping) {
      let typeInfo = this.typeIdToTypeInfo.get(typeId)!;
      typeInfo.shortTypeId = shortTypeId;
      this.shortTypeIdToTypeInfo[shortTypeId] = typeInfo;
    }
  }

  private registerClassWithShortId(
    konstructor: Constructor<T>,
    typeName: TypeName,
    shortTypeId: ShortTypeId
  ): TypeInfo<T> {
    let typeId = ClassRegistry.getTypeIdFromTypeName(typeName);
    if (this.typeIdToTypeInfo.has(typeId)) {
      throw new Error(
        `Key collision: ${typeName} collides with: ${
          this.typeIdToTypeInfo.get(typeId)!.typeName
        }`
      );
    }
    let typeInfo = new TypeInfo<T>(typeId, shortTypeId, typeName, konstructor);
    this.typeIdToTypeInfo.set(typeId, typeInfo);
    this.shortTypeIdToTypeInfo[shortTypeId] = typeInfo;
    this.constructorToTypeInfo.set(konstructor, typeInfo);
    return typeInfo;
  }

  private typeIdToTypeInfo = new Map<TypeId, TypeInfo<T>>();
  // Initialize with 1 empty slot to reserve 0 as an invalid shortTypeId to make mistakes stand out.
  // private startingId = 1;
  // TODO remove this temporary code for flushing out bugs:
  private startingId = Math.floor(Math.random() * 256);
  private shortTypeIdToTypeInfo = new Array<TypeInfo<T>>(this.startingId);
  private constructorToTypeInfo = new Map<Constructor<T>, TypeInfo<T>>();
}
