import * as XXH from 'xxhashjs';
const XXHASH_SEED = 0;
import {
  Serializable,
  SerializationStream,
} from './serialization';

// Trick to get nominally typed Id types
// https://basarat.gitbooks.io/typescript/docs/tips/nominalTyping.html
export enum _EntityIdBrand {}
export type EntityId = number & _EntityIdBrand;

export enum _ComponentIdBrand {}
export type ComponentId = number & _ComponentIdBrand;

export enum _ComponentKindBrand {}
export type ComponentKind = string & _ComponentKindBrand;

export enum _ComponentKindIdBrand {}
export type ComponentKindId = number & _ComponentKindIdBrand;

/**
 * Represents a component whose specific type is not statically known.
 * Allows type agnostic / bulk operations across all types of components.
 *
 * For now we'll say every component type is Serializable but perhaps
 * we'll loosen that restriction to allow simpler implementation of
 * non-networkable / non-persistable state
 * This could maybe be as simple as providing a default no-op'ed implementation
 * of serialize() that leaves the outer system ignorant to the fact it's not serializable
 * This no-op could be a NonSerializable class that implements the Serializable interface.
 * There's method to that madness. even if stuff cant be serialized it might make sense
 * to serialise its existence so that the reserved-ness of its ID is preserved or something...
 * So much to think about in terms of networking / save - restore and whether it's possible /
 * makes sense to unify them
 */
export interface GenericComponent extends Serializable {
  getId(): ComponentId;
  getKindId(): ComponentKindId;
  getOwnerId(): EntityId;
  getData(): Serializable;
  isDeleted(): boolean;
  delete(): void;
}

export interface Component<T extends Serializable> extends GenericComponent {
  getData(): T;
  setData(val: T): void;
}

export interface Entity {
  getId(): EntityId;
  getComponent<T extends Serializable>(componentType: new() => T): Component<T> | undefined;
  delete(): void;
}

/**
 * Represents all the entities' and components' states at a single point in time.
 * Mutable to support in-place update by Systems.
 *
 * This is the nice, statically typed interface we should expose to the wider world.
 * The Generic stuff in the implementation is necessarily type-erased for implementability
 * but hopefully should not need exposing.
 */
export interface EntityComponentState extends Serializable {
  createEntity(components?: Serializable[], entityId?: EntityId): Entity;
  /**
   * If entity already has component of this type, it overwrites existing component's data
   */
  addComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> | undefined;

  getComponents<T extends Serializable>(componentType: new() => T): Iterable<Component<T>>;
  getComponent<T extends Serializable>(componentType: new() => T, componentId: ComponentId): Component<T> | undefined;
  getComponentOfEntity<T extends Serializable>(componentType: new() => T, entityId: EntityId): Component<T> | undefined;

  getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U): Iterable<[Component<T>, Component<U>]>;
  getAspect<T extends Serializable, U extends Serializable, V extends Serializable>(
      componentTypeT: new() => T,
      componentTypeU: new() => U,
      componentTypeV: new() => V): Iterable<[Component<T>, Component<U>, Component<V>]>;

  getEntity(entityId: EntityId): Entity | undefined;

  deleteEntity(entityId: EntityId): void;
  deleteComponent<T extends Serializable>(componentType: new() => T, componentId: ComponentId): void;

  /**
   * Returns this same state, but all getters will filter out deleted entities and components.
   */
  withDeletedStateHidden(): EntityComponentState;
  purgeDeletedState(): void;
}

class ComponentImpl<T extends Serializable> implements Component<T> {
  constructor(
    public _kindId: ComponentKindId,
    public _id: ComponentId,
    public _ownerId: EntityId,
    public _data: T) {
  }
  public getId(): ComponentId { return this._id; }
  public getKindId(): ComponentKindId { return this._kindId; }
  public getOwnerId(): EntityId { return this._ownerId; }
  public getData(): T { return this._data; }
  public setData(val: T): void { this._data = val; }

  public _isDeleted = false;
  public isDeleted(): boolean {
    return this._isDeleted;
  }
  public delete(): void {
    this._isDeleted = true;
  }

  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, '_id');
    stream.serializeUint32(this, '_kindId');
    stream.serializeUint32(this, '_ownerId');
    stream.serializeBoolean(this, '_isDeleted');
    this._data.serialize(stream);
  }
}

type GenericComponentFactory = (
  kindId: ComponentKindId,
  id: ComponentId,
  ownerId: EntityId,
  data: any) => GenericComponent;

/**
 * A component that is builtin, marks entities as deleted
 */
class DeletedTag implements Serializable {
  public serialize(_stream: SerializationStream): void {
    // Nothing to serialize
  }
}

export class ComponentReflection {
  constructor() {
    this.registerType(DeletedTag, '__DeletedTag' as ComponentKind);
  }

  public getComponentKindId(componentKind: ComponentKind) {
    return XXH.h32(componentKind, XXHASH_SEED).toNumber();
  }
  // Allow the use of Function. It's truly the type of constructors in TS...
  // tslint:disable-next-line:ban-types
  public getComponentKindIdFromConstructor(ctor: Function) {
    return this.componentDataConstructorToComponentKindId.get(ctor);
  }
  public getComponentKind(componentKindId: ComponentKindId): ComponentKind | undefined {
    return this.componentKindIdToComponentKind.get(componentKindId);
  }
  public getComponentKindIds(): Iterable<ComponentKindId> {
    return this.componentKindIdToComponentKind.keys();
  }
  public registerType<T extends Serializable>(ctor: new() => T, componentKind: ComponentKind): ComponentKindId {
    let componentKindId = this.getComponentKindId(componentKind);
    this.componentKindIdToComponentKind.set(componentKindId, componentKind);
    this.componentKindIdToComponentDataConstructor.set(componentKindId, ctor);
    this.componentDataConstructorToComponentKindId.set(ctor, componentKindId);
    this.componentKindIdToComponentFactory.set(componentKindId, (
      kindId: ComponentKindId,
      id: ComponentId,
      ownerId: EntityId,
      data: T) => new ComponentImpl<T>(kindId, id, ownerId, data),
    );
    return componentKindId;
  }
  public constructComponentData(componentKindId: ComponentKindId) {
    return new (this.componentKindIdToComponentDataConstructor.get(componentKindId)!) ();
  }
  public constructComponent(
    componentKindId: ComponentKindId,
    id: ComponentId,
    ownerId: EntityId) {
    let data = new (this.componentKindIdToComponentDataConstructor.get(componentKindId)!) ();
    return this.constructComponentFromData(componentKindId, id,  ownerId, data);
  }
  public constructComponentFromData(
    componentKindId: ComponentKindId,
    id: ComponentId,
    ownerId: EntityId,
    data: any) {
    return this.componentKindIdToComponentFactory.get(componentKindId)!(componentKindId, id, ownerId, data);
  }

  private componentKindIdToComponentKind: Map<ComponentKindId, ComponentKind> = new Map();
  // Following pair are each others inverse
  private componentKindIdToComponentDataConstructor: Map<ComponentKindId, new() => Serializable> = new Map();
  // Allow the use of Function. It's truly the type of constructors in TS...
  // tslint:disable-next-line:ban-types
  private componentDataConstructorToComponentKindId: Map<Function, ComponentKindId> = new Map();
  private componentKindIdToComponentFactory: Map<ComponentKindId, GenericComponentFactory> = new Map();
}

export class EntityComponentStateImpl implements EntityComponentState {
  constructor(private componentReflection: ComponentReflection) {
    for (let componentKindId of this.componentReflection.getComponentKindIds()) {
      this.componentKindIdToComponents.set(componentKindId, new Map());
    }
  }

  public lastEntityId: EntityId = 0; // public to allow serialization
  private getNextEntityId(): EntityId {
    return ++this.lastEntityId;
  }

  public lastComponentId: ComponentId = 0; // public to allow serialization
  private getNextComponentId(): ComponentId {
    return ++this.lastComponentId;
  }

  public componentKindIdToComponents: Map<ComponentKindId, Map<ComponentId, GenericComponent>> = new Map();
  // redundant state for fast Entity-to-Components lookup
  public entityIdToComponents: Map<EntityId, Map<ComponentKindId, ComponentId>> = new Map();

  public createEntity(components?: Serializable[], entityId?: EntityId): Entity {
    // TODO This function probably needs to be more transactional
    let newEntityId = entityId !== undefined ? entityId : this.getNextEntityId();
    this.entityIdToComponents.set(newEntityId, new Map());
    if (components !== undefined) {
      for (let component of components) {
        this.createGenericComponent(newEntityId, component);
      }
    }
    return new EntityImpl(newEntityId, this);
  }

  public createGenericComponent(ownerId: EntityId, data: Serializable): GenericComponent {
    let newComponentId = this.getNextComponentId();
    let componentKindId = this.componentReflection.getComponentKindIdFromConstructor(data.constructor)!;
    let componentHandle = this.componentReflection.constructComponentFromData(
      componentKindId,
      newComponentId,
      ownerId,
      data);
    this.insertComponent(componentHandle);
    return componentHandle;
  }

  public addComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> | undefined {
    let componentConstructor = data.constructor as new() => T;
    let maybeComponent = this.getComponentOfEntity(componentConstructor, ownerId);
    if (maybeComponent && !maybeComponent.isDeleted()) {
      maybeComponent.setData(data);
      return maybeComponent;
    }
    return this.createGenericComponent(ownerId, data) as Component<T>;
  }

  public deleteEntity(entityId: EntityId): void {
    // TODO, eventually we should rig things so that once we know the deletion has been
    // replicated to all clients we destroy the actual data.
    // For now this "leaks" indefinitely.

    // Mark all the components as deleted so we don't return them in queries
    for (let component of this.getComponentsOfEntity(entityId)!) {
      component.delete();
    }
    this.addComponent(entityId, new DeletedTag());
  }

  public deleteComponent<T extends Serializable>(componentType: new() => T, componentId: ComponentId): void {
    // TODO, eventually we should rig things so that once we know the deletion has been
    // replicated to all clients we destroy the actual data.
    // For now this "leaks" indefinitely.
    this.getComponent(componentType, componentId)!.delete();
  }

  public *getAllComponents(): Iterable<GenericComponent> {
    for (let componentMap of this.componentKindIdToComponents.values()) {
      yield* componentMap.values();
    }
  }

  private _getComponents<T extends Serializable>(componentType: new() => T): Map<ComponentId, Component<T>> | undefined {
    let componentKindId = this.componentReflection.getComponentKindIdFromConstructor(componentType);
    if (componentKindId === undefined) {
      return undefined;
    }
    return this.getComponentsByKindId(componentKindId) as Map<ComponentId, Component<T>> | undefined;
  }

  public *getComponents<T extends Serializable>(componentType: new() => T): Iterable<Component<T>> {
    for (let component of this._getComponents(componentType)!.values()) {
      yield component;
    }
  }

  public getGenericComponent(componentKind: ComponentKind, componentId: ComponentId): GenericComponent | undefined {
    return this.getComponentsByKindId(this.componentReflection.getComponentKindId(componentKind)).get(componentId);
  }

  public getComponent<T extends Serializable>(componentType: new() => T, componentId: ComponentId): Component<T> | undefined {
    let componentsOfKind = this._getComponents(componentType);
    if (componentsOfKind === undefined) {
      return undefined;
    }
    return componentsOfKind.get(componentId);
  }

  public getComponentOfEntity<T extends Serializable>(componentType: new() => T, entityId: EntityId): Component<T> | undefined {
    let maybeEntityComponents = this.entityIdToComponents.get(entityId);
    if (maybeEntityComponents === undefined) {
      return undefined;
    }
    let maybeComponentId = maybeEntityComponents.get(this.componentReflection.getComponentKindIdFromConstructor(componentType)!);
    if (maybeComponentId === undefined) {
      return undefined;
    }
    return this.getComponent(componentType, maybeComponentId);
  }

  public *getComponentsOfEntity(entityId: EntityId): Iterable<GenericComponent> | undefined {
    let maybeEntityComponents = this.entityIdToComponents.get(entityId);
    if (maybeEntityComponents === undefined) {
      return undefined;
    }
    for (let [kindId, id] of maybeEntityComponents.entries()) {
      let componentsOfKind = this.getComponentsByKindId(kindId);
      yield componentsOfKind.get(id)!;
    }
  }

  // TODO maybe create a caching-y optimiser-y thing for aspect queries.
  public getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U): Iterable<[Component<T>, Component<U>]>;
  public getAspect<T extends Serializable, U extends Serializable, V extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U,
    componentTypeV: new() => V): Iterable<[Component<T>, Component<U>, Component<V>]>;
  public getAspect(...componentTypes: Array<new() => Serializable>): Iterable<GenericComponent[]> {
    return this.getAspectGeneric(componentTypes);
  }

  public *getAspectGeneric(componentTypes: Array<new() => Serializable>): Iterable<GenericComponent[]> {
    let componentTypeIdList = componentTypes.map((c) => this.componentReflection.getComponentKindIdFromConstructor(c));
    let anyUndefined = componentTypeIdList.indexOf(undefined) !== -1;
    if (anyUndefined) {
      return;
    }
    let componentsOfTypeList = (componentTypeIdList as ComponentKindId[]).map((id, index) => {
      return {
        kindId: id,
        components: this.getComponentsByKindId(id),
        originalIndex: index,
      };
    });
    // As an optimisation, sort the list by components types with the fewest members first so we early out faster when matching.
    componentsOfTypeList.sort((a, b) => a.components.size - b.components.size);
    for (let entityComponents of this.entityIdToComponents.values()) {
      let aspectToYield = new Array<GenericComponent>();
      let foundAll = true;
      for (let componentTypeToFind of componentsOfTypeList) {
        let maybeId = entityComponents.get(componentTypeToFind.kindId);
        if (maybeId === undefined) {
          foundAll = false;
          break;
        }
        let c = componentTypeToFind.components.get(maybeId)!;
        aspectToYield[componentTypeToFind.originalIndex] = c;
      }
      // Did we find all components?
      if (foundAll) {
        yield aspectToYield;
      }
    }
  }

  public getEntity(entityId: EntityId): Entity | undefined {
    if (this.entityIdToComponents.has(entityId)) {
      return new EntityImpl(entityId, this);
    }
    return undefined;
  }

  // Will get existing or new entry
  public getComponentsByKindId(componentKindId: ComponentKindId): Map<ComponentId, GenericComponent> {
    let maybeComponents = this.componentKindIdToComponents.get(componentKindId);
    if (maybeComponents !== undefined) {
      return maybeComponents;
    }
    let newComponents: Map<ComponentId, GenericComponent> = new Map();
    this.componentKindIdToComponents.set(componentKindId, newComponents);
    return newComponents;
  }

  public insertComponent(component: GenericComponent) {
    this.entityIdToComponents.get(component.getOwnerId())!.set(component.getKindId(), component.getId());
    this.getComponentsByKindId(component.getKindId()).set(component.getId(), component);
  }

  private deletionHidingFacade = new EntityComponentStateDeletionHidingFacade(this);
  public withDeletedStateHidden(): EntityComponentState {
    return this.deletionHidingFacade;
  }

  public purgeDeletedState(): void {
    for (let components of this.componentKindIdToComponents.values()) {
      for (let [componentId, component] of components) {
        if (component.isDeleted()) {
          components.delete(componentId);
        }
      }
    }
    let deletionTags = this.componentKindIdToComponents.get(this.componentReflection.getComponentKindIdFromConstructor(DeletedTag)!)!;
    for (let deletedTag of deletionTags.values()) {
      let deletedEntityId = deletedTag.getOwnerId();
      this.entityIdToComponents.delete(deletedEntityId);
    }
    deletionTags.clear();
  }

  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'lastEntityId');
    stream.serializeUint32(this, 'lastComponentId');
    let entityIdsLengthObj = {val: this.entityIdToComponents.size};
    stream.serializeUint32(entityIdsLengthObj, 'val');
    let ids8Buffer = {val: new Uint8Array(0)};
    if (stream.isWriting) {
      let ids32Buffer = Uint32Array.from(this.entityIdToComponents.keys());
      ids8Buffer = {val: new Uint8Array(ids32Buffer.buffer)};
    }
    stream.serializeUint8Array(ids8Buffer, 'val');
    if (stream.isReading) {
      let ids32Buffer = new Uint32Array(ids8Buffer.val);
      for (let entityId of ids32Buffer) {
        this.entityIdToComponents.set(entityId, new Map());
      }
    }

    let componentsLengthObj = {val: 0};
    if (stream.isWriting) {
      componentsLengthObj.val = Array.from(this.componentKindIdToComponents.values()).reduce(
        (acc: number, item) => {
          return acc + item.size;
        },
        0);
    }
    stream.serializeUint32(componentsLengthObj, 'val');
    if (stream.isWriting) {
      for (let componentIdToComponent of this.componentKindIdToComponents.values()) {
        for (let component of componentIdToComponent.values()) {
          let kindId = {val: component.getKindId()};
          stream.serializeUint32(kindId, 'val');
          component.serialize(stream);
        }
      }
    } else {
      for (let i = 0; i < componentsLengthObj.val; ++i) {
        let kindId = {val: 0};
        stream.serializeUint32(kindId, 'val');
        // TODO revisit the need to provide id params up front to the component constructor.
        let component = this.componentReflection.constructComponent(kindId.val, 0, 0);
        component.serialize(stream);
        this.insertComponent(component);
      }
    }
  }
}

class EntityImpl implements Entity {
  constructor(
    private readonly id: EntityId,
    private readonly ecState: EntityComponentState) {
  }
  public getId(): EntityId {
    return this.id;
  }
  public getComponent<T extends Serializable>(componentType: new() => T): Component<T> | undefined {
    return this.ecState.getComponentOfEntity<T>(componentType, this.id);
  }
  public delete(): void {
    this.ecState.deleteEntity(this.id);
  }
}

/**
 * Wraps an EntityComponentStateImpl and filters out all the deleted entities and components
 * making it appear that they do not exist
 */
export class EntityComponentStateDeletionHidingFacade implements EntityComponentState {
  constructor(private state: EntityComponentStateImpl) {}

  public serialize(stream: SerializationStream): void {
    this.state.serialize(stream);
  }

  public createEntity(components?: Serializable[], entityId?: EntityId): Entity {
    let entity = this.state.createEntity(components, entityId);
    return new EntityImpl(entity.getId(), this);
  }

  public addComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> | undefined {
    return this.state.addComponent(ownerId, data);
  }

  public *getComponents<T extends Serializable>(componentType: new() => T): Iterable<Component<T>> {
    for (let component of this.state.getComponents(componentType)) {
      if (!component.isDeleted()) {
        yield component;
      }
    }
  }

  public getComponent<T extends Serializable>(componentType: new() => T, componentId: ComponentId): Component<T> | undefined {
    let maybeComponent = this.state.getComponent(componentType, componentId);
    if (maybeComponent === undefined || maybeComponent.isDeleted()) {
      return undefined;
    }
    return maybeComponent;
  }

  public getComponentOfEntity<T extends Serializable>(componentType: new() => T, entityId: EntityId): Component<T> | undefined {
    let maybeComponent = this.state.getComponentOfEntity(componentType, entityId);
    if (maybeComponent === undefined || maybeComponent.isDeleted()) {
      return undefined;
    }
    return maybeComponent;
  }

  public getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U): Iterable<[Component<T>, Component<U>]>;
  public getAspect<T extends Serializable, U extends Serializable, V extends Serializable>(
    componentTypeT: new() => T,
    componentTypeU: new() => U,
    componentTypeV: new() => V): Iterable<[Component<T>, Component<U>, Component<V>]>;
  public *getAspect(...componentTypes: Array<new() => Serializable>): Iterable<GenericComponent[]> {
    for (let components of this.state.getAspectGeneric(componentTypes)) {
      if (components.some((c) => c.isDeleted())) {
        continue;
      }
      yield components;
    }
  }

  public getEntity(entityId: EntityId): Entity | undefined {
    let maybeEntity = this.state.getEntity(entityId);
    if (maybeEntity === undefined) {
      return undefined;
    }
    if (this.state.getComponentOfEntity(DeletedTag, entityId) !== undefined) {
      return undefined;
    }
    return new EntityImpl(entityId, this);
  }

  public deleteEntity(entityId: EntityId): void {
    return this.state.deleteEntity(entityId);
  }

  public deleteComponent<T extends Serializable>(componentType: new() => T, componentId: ComponentId): void {
    return this.state.deleteComponent(componentType, componentId);
  }

  public withDeletedStateHidden(): EntityComponentState {
    return this;
  }

  public purgeDeletedState(): void {
    return this.state.purgeDeletedState();
  }
}
