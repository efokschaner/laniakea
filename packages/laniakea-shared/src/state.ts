import { ClassRegistry } from './class-registry';
import { DeletedTag, EntityComponentDb, GenericComponent } from './entity-component-db';
import { ComponentId, ComponentTypeId, EntityId } from './ids';
import { Serializable, SerializationStream } from './serialization';

/**
 * Represents all the entities' and components' states at a single point in time.
 * Mutable to support in-place update by Systems.
 */
export interface EntityComponentState extends Serializable {
  createEntity(): Entity;
  getEntity(entityId: EntityId): Entity | undefined;
  deleteEntity(entityId: EntityId): void;
  /**
   * Returns a Component of the supplied type if the given entity owns one
   */
  getComponent<T extends Serializable>(componentType: new() => T, ownerId: EntityId): Component<T> | undefined;
  /**
   * Sets the component data of the given owner.
   * If entity already has component of this type, it overwrites existing component
   * If entity does not exist, it will return undefined.
   */
  setComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> | undefined;
  /**
   * Marks the component as deleted.
   */
  deleteComponent<T extends Serializable>(componentType: new() => T, ownerId: EntityId): void;
  /**
   * Gets all the components of the given type
   */
  getComponents<T extends Serializable>(componentType: new() => T): Iterable<Component<T>>;
  /**
   * Gets a tuple of components for each entity that has all the provided component types
   */
  getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U): Iterable<[Component<T>, Component<U>]>;
  getAspect<T extends Serializable, U extends Serializable, V extends Serializable>(
      componentTypeT: new() => T,
      componentTypeU: new() => U,
      componentTypeV: new() => V): Iterable<[Component<T>, Component<U>, Component<V>]>;
  /**
   * Returns this same state, but all getters will filter out deleted entities and components.
   */
  withDeletedStateHidden(): EntityComponentState;
  /**
   * Drops all components and entities marked as deleted from the data
   */
  releaseDeletedState(): void;
  /**
   * Return the underlying dynamically-typed state.
   * NB this object will never hide deleted state.
   */
  getEntityComponentDb(): EntityComponentDb;
}

/**
 * Wraps EntityId to make certain EntityComponentState calls more fluent
 */
export class Entity {
  constructor(
    private readonly _ecState: EntityComponentState,
    private readonly _id: EntityId) {
  }
  public getId(): EntityId {
    return this._id;
  }
  public getComponent<T extends Serializable>(componentType: new() => T): Component<T> | undefined {
    return this._ecState.getComponent(componentType, this._id);
  }
  public setComponent<T extends Serializable>(data: T): Component<T> {
    return this._ecState.setComponent(this._id, data)!;
  }
  public isDeleted(): boolean {
    return this._ecState.getComponent(DeletedTag, this._id) !== undefined;
  }
  public delete(): void {
    this._ecState.deleteEntity(this._id);
  }
}

/**
 * Wraps ComponentId to make certain EntityComponentState calls more fluent
 */
export class Component<T extends Serializable> {
  constructor(
    private readonly _ecState: EntityComponentState,
    private readonly _id: ComponentId) {
  }
  public getId(): ComponentId { return this._id; }
  public getOwner(): Entity { return new Entity(this._ecState, this._id.ownerId); }
  public getData(): T { return this.getComponentFromDb().data as T; }
  public setData(val: T): void { this._ecdb.setComponent(this._id, val); }
  public isDeleted(): boolean {
    return this.getComponentFromDb().isDeleted;
  }
  public delete(): void {
    this.getComponentFromDb().isDeleted = true;
  }

  private getComponentFromDb(): GenericComponent {
    return this._ecdb.getComponent(this._id)!;
  }
  private _ecdb = this._ecState.getEntityComponentDb();
}

/**
 * Wraps an EntityComponentDb to provide a statically-typed, more ORM-like interface.
 * If you want raw access to the dynamically-typed component data, grab the EntityComponentDb
 */
export class EntityComponentStateImpl implements EntityComponentState {
  constructor(
    private componentTypes: Array<ComponentTypeId>,
    private classRegistry: ClassRegistry
  ) {
  }

  public createEntity(): Entity {
    return new Entity(this, this.entityComponentDb.createEntity());
  }

  public getEntity(entityId: EntityId): Entity | undefined {
    return this.entityComponentDb.hasEntity(entityId) ? new Entity(this, entityId) : undefined;
  }

  public deleteEntity(entityId: EntityId): void {
    this.entityComponentDb.deleteEntity(entityId);
  }

  public getComponent<T extends Serializable>(componentType: new() => T, ownerId: EntityId): Component<T> | undefined {
    let typeId = this.classRegistry.getTypeInfoByConstructor(componentType)!.shortTypeId;
    let componentId = new ComponentId(typeId, ownerId);
    if (!this.entityComponentDb.hasComponent(componentId)) {
      return undefined;
    }
    return new Component<T>(this, componentId);
  }

  public setComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> | undefined {
    if (!this.entityComponentDb.hasEntity(ownerId)) {
      return undefined;
    }
    let componentConstructor = data.constructor as { new(): T };
    let typeId = this.classRegistry.getTypeInfoByConstructor(componentConstructor)!.shortTypeId;
    let componentId = new ComponentId(typeId, ownerId);
    this.entityComponentDb.setComponent(componentId, data);
    return new Component<T>(this, componentId);
  }

  public deleteComponent<T extends Serializable>(componentType: new() => T, ownerId: EntityId): void {
    let typeId = this.classRegistry.getTypeInfoByConstructor(componentType)!.shortTypeId;
    let componentId = new ComponentId(typeId, ownerId);
    this.entityComponentDb.deleteComponent(componentId);
  }

  public *getComponents<T extends Serializable>(componentType: new() => T): Iterable<Component<T>> {
    let typeId = this.classRegistry.getTypeInfoByConstructor(componentType)!.shortTypeId;
    for(let genericComponent of this.entityComponentDb.getAllComponentsOfType(typeId)) {
      yield new Component<T>(this, genericComponent.id);
    }
  }

  public getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U
  ): Iterable<[Component<T>, Component<U>]>;
  public getAspect<T extends Serializable, U extends Serializable, V extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U,
    componentTypeV: new() => V
  ): Iterable<[Component<T>, Component<U>, Component<V>]>;
  public getAspect(...componentTypes: Array<new() => Serializable>): Iterable<Array<Component<Serializable>>> {
    return this.getAspectGeneric(componentTypes);
  }

  public *getAspectGeneric(componentTypes: Array<new() => Serializable>): Iterable<Array<Component<Serializable>>> {
    let componentTypeIds = componentTypes.map((c) => this.classRegistry.getTypeInfoByConstructor(c)!.shortTypeId);
    let componentsOfTypeList = componentTypeIds.map((typeId, index) => {
      return {
        typeId,
        numComponents: this.entityComponentDb.getNumComponentsOfType(typeId),
        originalIndex: index,
      };
    });
    // As an optimisation, sort the list by components types with the fewest members first so we early out faster when matching.
    componentsOfTypeList.sort((a, b) => a.numComponents - b.numComponents);
    for (let entityId of this.entityComponentDb.getAllEntities()) {
      let aspectToYield = new Array<Component<Serializable>>();
      let foundAll = true;
      for (let componentTypeToFind of componentsOfTypeList) {
        let componentId = new ComponentId(componentTypeToFind.typeId, entityId);
        if (!this.entityComponentDb.hasComponent(componentId)) {
          foundAll = false;
          break;
        }
        aspectToYield[componentTypeToFind.originalIndex] = new Component(this, componentId);
      }
      if (foundAll) {
        yield aspectToYield;
      }
    }
  }

  private deletionHidingFacade = new EntityComponentStateDeletionHidingFacade(this);
  public withDeletedStateHidden(): EntityComponentState {
    return this.deletionHidingFacade;
  }

  public releaseDeletedState(): void {
    this.entityComponentDb.releaseDeletedState();
  }

  public serialize(stream: SerializationStream): void {
    this.entityComponentDb.serialize(stream);
  }

  public getEntityComponentDb(): EntityComponentDb {
    return this.entityComponentDb;
  }
  private entityComponentDb = new EntityComponentDb(this.componentTypes, this.classRegistry);
}

/**
 * Wraps an EntityComponentStateImpl and filters out all the deleted entities and components
 * making it appear that they do not exist
 */
export class EntityComponentStateDeletionHidingFacade implements EntityComponentState {
  constructor(private state: EntityComponentStateImpl) {}

  public createEntity(): Entity {
    return this.state.createEntity();
  }

  public getEntity(entityId: EntityId): Entity | undefined {
    let maybeEntity = this.state.getEntity(entityId);
    if (maybeEntity === undefined) {
      return undefined;
    }
    if (maybeEntity.isDeleted()) {
      return undefined;
    }
    return maybeEntity;
  }

  public deleteEntity(entityId: EntityId): void {
    return this.state.deleteEntity(entityId);
  }

  public getComponent<T extends Serializable>(componentType: new() => T, ownerId: EntityId): Component<T> | undefined {
    let maybeComponent = this.state.getComponent(componentType, ownerId);
    if (maybeComponent === undefined || maybeComponent.isDeleted()) {
      return undefined;
    }
    return maybeComponent;
  }

  public setComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> | undefined {
    return this.state.setComponent(ownerId, data);
  }

  public deleteComponent<T extends Serializable>(componentType: new() => T, ownerId: EntityId): void {
    return this.state.deleteComponent(componentType, ownerId);
  }

  public *getComponents<T extends Serializable>(componentType: new() => T): Iterable<Component<T>> {
    for (let component of this.state.getComponents(componentType)) {
      if (!component.isDeleted()) {
        yield component;
      }
    }
  }

  public getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U
  ): Iterable<[Component<T>, Component<U>]>;
  public getAspect<T extends Serializable, U extends Serializable, V extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U,
    componentTypeV: new() => V
  ): Iterable<[Component<T>, Component<U>, Component<V>]>;
  public *getAspect(...componentTypes: Array<{new(): Serializable}>): Iterable<Array<{}>> {
    for (let components of this.state.getAspectGeneric(componentTypes)) {
      if (components.some((c) => c.isDeleted())) {
        continue;
      }
      yield components;
    }
  }

  public withDeletedStateHidden(): EntityComponentState {
    return this;
  }

  public releaseDeletedState(): void {
    return this.state.releaseDeletedState();
  }

  public getEntityComponentDb(): EntityComponentDb {
    return this.state.getEntityComponentDb();
  }

  public serialize(stream: SerializationStream): void {
    this.state.serialize(stream);
  }
}
