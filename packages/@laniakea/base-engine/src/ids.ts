import {
  MAX_SHORT_TYPE_ID_EXCLUSIVE,
  NominalType,
  Serializable,
  SerializationStream,
  ShortTypeId,
} from '@laniakea/utils';

/**
 * The id of the type of a component
 */
export type ComponentTypeId = ShortTypeId;

/**
 * The id of an entity
 */
export type EntityId = NominalType<number, 'EntityId'>;

/**
 * The two parts of ComponentId combined in to 1 number.
 * Good for use as a key in a map.
 */
export type NumericComponentId = NominalType<number, 'NumericComponentId'>;

/**
 * Compound Id for a component
 */
export class ComponentId implements Serializable {
  public constructor(
    public typeId = 0 as ComponentTypeId,
    public ownerId = 0 as EntityId
  ) {}

  public equals(other: ComponentId): boolean {
    return this.ownerId === other.ownerId && this.typeId === other.typeId;
  }

  public serialize(stream: SerializationStream): void {
    this.typeId = stream.serializeUint16(this.typeId) as ComponentTypeId;
    this.ownerId = stream.serializeUint32(this.ownerId) as EntityId;
  }

  public asNumericId(): NumericComponentId {
    return (this.ownerId * MAX_SHORT_TYPE_ID_EXCLUSIVE +
      (this.typeId as number)) as NumericComponentId;
  }

  public static fromNumericId(numericId: NumericComponentId): ComponentId {
    let typeId = (numericId % MAX_SHORT_TYPE_ID_EXCLUSIVE) as ComponentTypeId;
    let ownerId = Math.floor(
      numericId / MAX_SHORT_TYPE_ID_EXCLUSIVE
    ) as EntityId;
    return new ComponentId(typeId, ownerId);
  }
}

/**
 * EntityIds are 32 bits
 */
export let ENTITY_ID_NUM_BITS = 32;
export let MAX_VALID_ENTITY_ID_INCLUSIVE = 2 ** ENTITY_ID_NUM_BITS - 1;

export class EntityIdGenerator implements Serializable {
  public getNextEntityId(): EntityId {
    if (this.lastEntityId >= MAX_VALID_ENTITY_ID_INCLUSIVE) {
      throw new Error('EntityId range exceeded.');
    }
    // Preincrement, entity Ids start at 1 so that 0 is a clearly invalid value
    return ++this.lastEntityId as EntityId;
  }

  public serialize(stream: SerializationStream): void {
    this.lastEntityId = stream.serializeFloat64(this.lastEntityId) as EntityId;
  }

  public lastEntityId = 0 as EntityId; // public to allow serialization
}
