
import { ClassRegistry, Serializable, SerializationStream } from '@laniakea/utils';
import { ComponentId, ComponentTypeId, EntityId, EntityIdGenerator } from './ids';

/**
 * Represents a component whose specific type is not statically known.
 * Allows type-agnostic / bulk operations across all types of components.
 *
 * For now we'll say every component type is Serializable but perhaps
 * we'll loosen that restriction to allow simpler implementation of
 * non-networkable / non-persistable state
 */
export class GenericComponent {
  constructor(
    public readonly id: ComponentId,
    public data: Serializable) {
  }
  public isDeleted = false;
}

/**
 * Combines a Component with its serialized data.
 * Useful for caching serialization work.
 */
export interface ComponentAndSerializedData {
  component: GenericComponent;
  serializedData: Uint8Array;
}

/**
 * Builtin component type that marks entities as deleted
 */
export class DeletedTag implements Serializable {
  public serialize(_stream: SerializationStream): void {
    // Nothing to serialize
  }
}

/**
 * This is the purely id-based kernel of state management / indexing
 */
export class EntityComponentDb {
  constructor(
    private componentTypes: ComponentTypeId[],
    private classRegistry: ClassRegistry) {
    for (let componentTypeId of this.componentTypes) {
      this.componentTypeIdToComponents.set(componentTypeId, new Map());
    }
  }

  public createEntity(): EntityId {
    let entityId = this.entityIdGenerator.getNextEntityId();
    this.entityIdToComponents.set(entityId, new Map());
    return entityId;
  }

  public hasEntity(entityId: EntityId): boolean {
    return this.entityIdToComponents.has(entityId);
  }

  public getAllEntities(): Iterable<EntityId> {
    return this.entityIdToComponents.keys();
  }

  /**
   * Marks an entity and all its components as deleted, they are still in the db until they are "released"
   */
  public deleteEntity(entityId: EntityId): void {
    if (!this.hasEntity(entityId)) {
      return;
    }
    // Mark all the components as deleted
    for (let component of this.getAllComponentsOfEntity(entityId)) {
      component.isDeleted = true;
    }
    let deletedTagComponentId = new ComponentId(this.deletedTagTypeInfo.shortTypeId, entityId);
    this.setComponent(deletedTagComponentId, new DeletedTag());
  }

  /**
   * Release is "final" and releases references, whereas deletion is just a marker.
   * Releases the entity and all of its components
   * @param entityId The entity to release
   */
  public releaseEntity(entityId: EntityId): void {
    let componentsOfEntityId = this.entityIdToComponents.get(entityId)!;
    for (let [componentTypeId ] of componentsOfEntityId) {
      this.componentTypeIdToComponents.get(componentTypeId)!.delete(entityId);
    }
    this.entityIdToComponents.delete(entityId);
  }

  public hasComponent(componentId: ComponentId): boolean {
    let componentsOfTypeId = this.componentTypeIdToComponents.get(componentId.typeId)!;
    return componentsOfTypeId.has(componentId.ownerId);
  }

  public getComponent(componentId: ComponentId): GenericComponent|undefined {
    let componentsOfTypeId = this.componentTypeIdToComponents.get(componentId.typeId)!;
    return componentsOfTypeId.get(componentId.ownerId);
  }

  public setComponent(componentId: ComponentId, data: Serializable): GenericComponent {
    let newComponent = new GenericComponent(componentId, data);
    let componentsOfEntityId = this.entityIdToComponents.get(componentId.ownerId);
    if (componentsOfEntityId === undefined) {
      componentsOfEntityId = new Map();
      this.entityIdToComponents.set(componentId.ownerId, componentsOfEntityId);
    }
    componentsOfEntityId.set(componentId.typeId, newComponent);
    let componentsOfTypeId = this.componentTypeIdToComponents.get(componentId.typeId)!;
    componentsOfTypeId.set(componentId.ownerId, newComponent);
    return newComponent;
  }

  public *getAllComponents(): Iterable<GenericComponent> {
    for (let componentsOfType of this.componentTypeIdToComponents.values()) {
        yield* componentsOfType.values();
    }
  }

  public *getAllComponentsOfType(componentTypeId: ComponentTypeId): Iterable<GenericComponent> {
    let componentsOfType = this.componentTypeIdToComponents.get(componentTypeId)!;
    yield* componentsOfType.values();
  }

  public *getAllComponentsOfEntity(ownerId: EntityId): Iterable<GenericComponent> {
    let componentsOfEntity = this.entityIdToComponents.get(ownerId)!;
    yield* componentsOfEntity.values();
  }

  public getNumComponentsOfType(componentTypeId: ComponentTypeId): number {
    let componentsOfType = this.componentTypeIdToComponents.get(componentTypeId)!;
    return componentsOfType.size;
  }

  /**
   * Marks a component as deleted, the component is still in the db until it is "released"
   */
  public deleteComponent(componentId: ComponentId): void {
    let maybeComponent = this.getComponent(componentId);
    if (maybeComponent !== undefined) {
      maybeComponent.isDeleted = true;
    }
  }

  /**
   * Release is "final" and releases references, whereas deletion is just a marker.
   * @param componentId The entity to release
   */
  public releaseComponent(componentId: ComponentId): void {
    let componentsOfEntityId = this.entityIdToComponents.get(componentId.ownerId);
    if (componentsOfEntityId !== undefined) {
      componentsOfEntityId.delete(componentId.typeId);
    }
    let componentsOfTypeId = this.componentTypeIdToComponents.get(componentId.typeId)!;
    componentsOfTypeId.delete(componentId.ownerId);
  }

  public releaseDeletedState(): void {
    let deletedTagComponents = this.componentTypeIdToComponents.get(this.deletedTagTypeInfo.shortTypeId)!;
    for (let [ownerId ] of deletedTagComponents!) {
      // Releasing the entity releases its deleted tag too
      this.releaseEntity(ownerId);
    }
    for (let component of this.getAllComponents()) {
      if (component.isDeleted) {
        this.releaseComponent(component.id);
      }
    }
  }

  public serialize(stream: SerializationStream): void {
    this.entityIdGenerator.serialize(stream);
    if (stream.isWriting) {
      let numComponentTypes = this.componentTypeIdToComponents.size;
      stream.writeUint8(numComponentTypes);
      for (let [typeId, componentsByOwner] of this.componentTypeIdToComponents) {
        stream.writeUint16(typeId);
        let numComponents = componentsByOwner.size;
        stream.writeUint16(numComponents);
        for (let [ownerId, component] of componentsByOwner) {
          stream.writeUint32(ownerId);
          component.data.serialize(stream);
          stream.writeBoolean(component.isDeleted);
        }
      }
    } else {
      this.componentTypeIdToComponents.forEach((each) => each.clear());
      this.entityIdToComponents.clear();
      let numComponentTypes = stream.readUint8();
      for (let i = 0; i < numComponentTypes; ++i) {
        let componentTypeId = stream.readUint16() as ComponentTypeId;
        let componentTypeInfo = this.classRegistry.getTypeInfoByShortTypeId(componentTypeId)!;
        let numComponents = stream.readUint16();
        for (let j = 0; j < numComponents; ++j) {
          let ownerId = stream.readUint32() as EntityId;
          let componentData = componentTypeInfo.construct() as Serializable;
          componentData.serialize(stream);
          let newComponent = this.setComponent(new ComponentId(componentTypeId, ownerId), componentData);
          newComponent.isDeleted = stream.readBoolean();
        }
      }
    }
  }

  private deletedTagTypeInfo = this.classRegistry.getTypeInfoByConstructor(DeletedTag)!;
  private entityIdGenerator = new EntityIdGenerator();
  private componentTypeIdToComponents: Map<ComponentTypeId, Map<EntityId, GenericComponent>> = new Map();
  // redundant state for fast Entity-to-Components lookup
  private entityIdToComponents: Map<EntityId, Map<ComponentTypeId, GenericComponent>> = new Map();
}
