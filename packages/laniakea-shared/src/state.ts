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
}

export interface Component<T extends Serializable> extends GenericComponent {
  getData(): T;
  setData(val: T): void;
}

export interface Entity {
  getId(): EntityId;
  getComponent<T extends Serializable>(componentType: {new(): T}): Component<T> | undefined;
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
  createComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T>;

  getComponents<T extends Serializable>(componentType: {new(): T}): Iterable<Component<T>>;
  getComponent<T extends Serializable>(componentType: {new(): T}, componentId: ComponentId): Component<T> | undefined;
  getComponentOfEntity<T extends Serializable>(componentType: {new(): T}, entityId: EntityId): Component<T> | undefined;
  getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: {new(): T},
    componentTypeU: {new(): U}): Iterable<[Component<T>, Component<U>]> | undefined;
  getEntity(entityId: EntityId): Entity | undefined;

  removeEntity(entityId: EntityId): void;
  removeComponent(componentId: ComponentId): void;
}

class ComponentImpl<T extends Serializable> implements Component<T> {
  constructor(
    public kindId: ComponentKindId,
    public id: ComponentId,
    public ownerId: EntityId,
    public data: T) {
  }
  public getId(): ComponentId { return this.id; }
  public getKindId(): ComponentKindId { return this.kindId; }
  public getOwnerId(): EntityId { return this.ownerId; }
  public getData(): T { return this.data; }
  public setData(val: T): void { this.data = val; }
  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'id');
    stream.serializeUint32(this, 'kindId');
    stream.serializeUint32(this, 'ownerId');
    this.data.serialize(stream);
  }
}

type GenericComponentFactory = (
  kindId: ComponentKindId,
  id: ComponentId,
  ownerId: EntityId,
  data: any) => GenericComponent;

export class ComponentReflection {
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
  public registerType<T extends Serializable>(ctor: {new(): T}, componentKind: ComponentKind): ComponentKindId {
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
  private componentKindIdToComponentDataConstructor: Map<ComponentKindId, {new(): Serializable}> = new Map();
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

  public entityIds: Set<EntityId> = new Set();
  public componentKindIdToComponents: Map<ComponentKindId, Map<ComponentId, GenericComponent>> = new Map();
  // redundant state for fast Entity-to-Components lookup
  public entityIdToComponents: Map<EntityId, Map<ComponentKindId, ComponentId>> = new Map();

  public createEntity(components?: Serializable[], entityId?: EntityId): Entity {
    // TODO This function probably needs to be more transactional
    let newEntityId = entityId !== undefined ? entityId : this.getNextEntityId();
    this.entityIds.add(newEntityId);
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
    this.addComponent(componentHandle);
    return componentHandle;
  }

  public createComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> {
    return this.createGenericComponent(ownerId, data) as Component<T>;
  }

  public removeEntity(entityId: EntityId): void {
    throw new Error('Unimplemented');
  }

  public removeComponent(componentId: ComponentId): void {
    throw new Error('Unimplemented');
  }

  public *getAllComponents(): Iterable<GenericComponent> {
    for (let componentMap of this.componentKindIdToComponents.values()) {
      yield* componentMap.values();
    }
  }

  private _getComponents<T extends Serializable>(componentType: {new(): T}): Map<ComponentId, Component<T>> | undefined {
    return this.componentKindIdToComponents.get(
      this.componentReflection.getComponentKindIdFromConstructor(componentType)!,
    ) as Map<ComponentId, Component<T>> | undefined;
  }

  public getComponents<T extends Serializable>(componentType: {new(): T}): Iterable<Component<T>> {
    return this._getComponents(componentType)!.values();
  }

  public getGenericComponent(componentKind: ComponentKind, componentId: ComponentId): GenericComponent | undefined {
    return this.getComponentsByKindId(this.componentReflection.getComponentKindId(componentKind)).get(componentId);
  }

  public getComponent<T extends Serializable>(componentType: {new(): T}, componentId: ComponentId): Component<T> | undefined {
    let componentsOfKind = this._getComponents(componentType);
    if (componentsOfKind === undefined) {
      return undefined;
    }
    return componentsOfKind.get(componentId);
  }

  public getComponentOfEntity<T extends Serializable>(componentType: {new(): T}, entityId: EntityId): Component<T> | undefined {
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

  // TODO !!!! this relies on insertion order and might break down on the client
  // when we change networking
  public *getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: {new(): T},
    componentTypeU: {new(): U}): Iterable<[Component<T>, Component<U>]> | undefined {
    let componentTypeIdT = this.componentReflection.getComponentKindIdFromConstructor(componentTypeT)!;
    let componentTypeIdU = this.componentReflection.getComponentKindIdFromConstructor(componentTypeU)!;
    let componentsOfKindT = this.getComponents<T>(componentTypeT);
    let componentsOfKindU = this.getComponents<U>(componentTypeU);
    if (componentsOfKindT === undefined || componentsOfKindU === undefined) {
      return undefined;
    }
    let generatorT = componentsOfKindT[Symbol.iterator]();
    let generatorU = componentsOfKindU[Symbol.iterator]();
    let iteratorT = generatorT.next();
    let iteratorU = generatorU.next();
    for (let entityComponents of this.entityIdToComponents.values()) {
      let hasT = entityComponents.has(componentTypeIdT);
      let hasU = entityComponents.has(componentTypeIdU);
      if (hasT && hasU) {
        yield [iteratorT.value, iteratorU.value];
      }
      if (hasT) {
        iteratorT = generatorT.next();
      }
      if (hasU) {
        iteratorU = generatorU.next();
      }
    }
  }

  public getEntity(entityId: EntityId): Entity | undefined {
    if (this.entityIds.has(entityId)) {
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

  public addComponent(component: GenericComponent) {
    this.entityIdToComponents.get(component.getOwnerId())!.set(component.getKindId(), component.getId());
    this.getComponentsByKindId(component.getKindId()).set(component.getId(), component);
  }

  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'lastEntityId');
    stream.serializeUint32(this, 'lastComponentId');
    let entityIdsLengthObj = {val: this.entityIds.size};
    stream.serializeUint32(entityIdsLengthObj, 'val');
    let ids8Buffer = {val: new Uint8Array(0)};
    if (stream.isWriting) {
      let ids32Buffer = Uint32Array.from(this.entityIds);
      ids8Buffer = {val: new Uint8Array(ids32Buffer.buffer)};
    }
    stream.serializeUint8Array(ids8Buffer, 'val');
    if (stream.isReading) {
      let ids32Buffer = new Uint32Array(ids8Buffer.val);
      this.entityIds = new Set(ids32Buffer);
      for (let entityId of this.entityIds) {
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
        this.addComponent(component);
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
  public getComponent<T extends Serializable>(componentType: {new(): T}): Component<T> | undefined {
    return this.ecState.getComponentOfEntity<T>(componentType, this.id);
  }
}
