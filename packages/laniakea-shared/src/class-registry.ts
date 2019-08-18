import * as XXH from 'xxhashjs';
import { NominalType } from './nominal-type';
import { S2C_BuiltinHandshakeMessage } from './network/builtin-messages';

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

export type GenericConstructor = new(...args: any[]) => {};

export class TypeInfo {
  constructor(
    public typeId: TypeId,
    public shortTypeId: ShortTypeId,
    public typeName: TypeName,
    public konstructor: GenericConstructor) {
  }

  construct(...args: any[]): {} {
    return new this.konstructor(...args);
  }
}

export class ClassRegistry {
  public static getTypeIdFromTypeName(typeName: TypeName): TypeId {
    return XXH.h32(typeName, XXHASH_SEED).toNumber() as TypeId;
  }

  constructor() {
    // TODO find a cleaner place / approach
    this.registerClassWithShortId(S2C_BuiltinHandshakeMessage, '__S2C_BuiltinHandshakeMessage', 1 as ShortTypeId);
  }

  public getTypeInfoByTypeId(typeId: TypeId): TypeInfo | undefined {
    return this.typeIdToTypeInfo.get(typeId);
  }

  public getTypeInfoByShortTypeId(shortTypeId: ShortTypeId): TypeInfo | undefined {
    return this.shortTypeIdToTypeInfo[shortTypeId];
  }

  public getTypeInfoByTypeName(typeName: TypeName) : TypeInfo | undefined {
    return this.typeIdToTypeInfo.get(ClassRegistry.getTypeIdFromTypeName(typeName));
  }

  public getTypeInfoByConstructor(konstructor: GenericConstructor) : TypeInfo | undefined {
    return this.constructorToTypeInfo.get(konstructor);
  }

  public registerClass(konstructor: GenericConstructor, typeName: TypeName): TypeInfo {
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
    return Array.from(this.typeIdToTypeInfo.entries()).map(([t,info]) => [t, info.shortTypeId]);
  }

  /**
   * Receive the dumped mapping and overwrite our mapping with it.
   */
  public setTypeIdToShortTypeIdMapping(mapping: Array<[TypeId, ShortTypeId]>) {
    this.shortTypeIdToTypeInfo = new Array<TypeInfo>();
    for(let [typeId, shortTypeId] of mapping) {
      let typeInfo = this.typeIdToTypeInfo.get(typeId)!;
      typeInfo.shortTypeId = shortTypeId;
      this.shortTypeIdToTypeInfo[shortTypeId] = typeInfo;
    }
  }

  private registerClassWithShortId(konstructor: GenericConstructor, typeName: TypeName, shortTypeId: ShortTypeId): TypeInfo {
    let typeId = ClassRegistry.getTypeIdFromTypeName(typeName);
    if (this.typeIdToTypeInfo.has(typeId)) {
      throw new Error(`Key collision: ${typeName} collides with: ${this.typeIdToTypeInfo.get(typeId)}`);
    }
    let typeInfo = new TypeInfo(
      typeId,
      shortTypeId,
      typeName,
      konstructor
    );
    this.typeIdToTypeInfo.set(typeId, typeInfo);
    this.shortTypeIdToTypeInfo[shortTypeId] = typeInfo;
    this.constructorToTypeInfo.set(konstructor, typeInfo);
    return typeInfo;
  }

  private typeIdToTypeInfo = new Map<TypeId, TypeInfo>();
  // Initialize with 1 empty slot to reserve 0 as an invalid shortTypeId to make mistakes stand out.
  // private startingId = 1;
  // TODO remove this temporary code for flushing out bugs:
  private startingId = Math.floor(Math.random() * 256);
  private shortTypeIdToTypeInfo = new Array<TypeInfo>(this.startingId);
  private constructorToTypeInfo = new Map<GenericConstructor, TypeInfo>();
}
