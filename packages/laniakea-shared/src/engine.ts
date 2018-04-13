import * as XXH from 'xxhashjs';

const XXHASH_SEED = 0;

import {
  SerializationStream,
  Serializable,
  measureAndSerialize,
  ReadStream
} from './serialization';

import {
  InputFrame,
  NumericEnum,
  createInputFrameFromDownButtons
} from './input';


// Trick to get nominally typed Id types
// https://basarat.gitbooks.io/typescript/docs/tips/nominalTyping.html
export enum _EntityIdBrand {}
export enum _ComponentIdBrand {}
export enum _ComponentKindBrand {}
export enum _ComponentKindIdBrand {}

export type EntityId = number & _EntityIdBrand;
export type ComponentId = number & _ComponentIdBrand;
export type ComponentKind = string & _ComponentKindBrand;
export type ComponentKindId = number & _ComponentKindIdBrand;

export enum _PlayerIdBrand {}
export type PlayerId = number & _PlayerIdBrand;

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
  getData() : Serializable;
}

export interface Component<T extends Serializable> extends GenericComponent {
  getData() : T;
  setData(val: T) : void;
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

  getComponents<T extends Serializable>(componentType: {new():T}): Iterable<Component<T>>;
  getComponent<T extends Serializable>(componentType: {new():T}, componentId: ComponentId): Component<T> | undefined;
  getComponentOfEntity<T extends Serializable>(componentType: {new():T}, entityId: EntityId): Component<T> | undefined;
  getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: {new():T},
    componentTypeU: {new():U}): Iterable<[Component<T>, Component<U>]> | undefined;
  getEntity(entityId: EntityId): Entity | undefined;

  removeEntity(entityId: EntityId): void;
  removeComponent(componentId: ComponentId): void;
}

export class SimluationFrameData {
  constructor(
    public simulationFrameIndex: number,
    public simulationTimeS: number,
    public inputs: Map<PlayerId, InputFrame>,
    public state: EntityComponentState) {
    }
}

export interface StepParams {
  simulationTimeS: number;
  timeDeltaS: number;
  inputs: Map<PlayerId, InputFrame>;
  state: EntityComponentState;
  previousFrameInputs: Map<PlayerId, InputFrame>;
  previousFrameState: EntityComponentState;
  previousFrameSimulationTimeS: number;
}

export interface System {
  Step(stepParams: StepParams): void;
}

export interface Engine {
  // State Registration
  registerComponentType<T extends Serializable>(componentType: {new():T}, componentKind: ComponentKind): void;

  // Input Registration
  registerButtons(buttonsEnum: NumericEnum): void

  // System Registration
  addSystem(system: System): void;
  removeSystem(system: System): void;

  // State + Input utils
  createState() : EntityComponentState;
  copySimulationState(src: EntityComponentState, dst: EntityComponentState) : void
  createSimulationFrame() : SimluationFrameData;
  createInputFrameFromDownButtons(downButtons: Set<number>): InputFrame;

  /**
   * Runs 1 simulation step with duration of timeDeltaS to produce nextFrame from previousFrame
   * using the simulation provided by the registered systems.
   */
  stepSimulation(timeDeltaS: number, previousFrame: SimluationFrameData, nextFrame: SimluationFrameData): void;
}

export function createEngine(): Engine {
  return new EngineImpl();
}


class ComponentImpl<T extends Serializable> implements Component<T> {
  constructor(
    public kindId: ComponentKindId,
    public id: ComponentId,
    public ownerId: EntityId,
    public data: T) {
  }
  getId(): ComponentId { return this.id; }
  getKindId(): ComponentKindId { return this.kindId; }
  getOwnerId(): EntityId { return this.ownerId; }
  getData() : T { return this.data; }
  setData(val: T) : void { this.data = val; }
  serialize(stream: SerializationStream): void {
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

type ComponentFactory<T extends Serializable> = (
  kindId: ComponentKindId,
  id: ComponentId,
  ownerId: EntityId,
  data: T) => Component<T>;

class ComponentReflection {
  getComponentKindId(componentKind: ComponentKind) {
    return XXH.h32(componentKind, XXHASH_SEED).toNumber();
  }
  getComponentKindIdFromConstructor(ctor: Function) {
    return this.componentDataConstructorToComponentKindId.get(ctor);
  }
  getComponentKind(componentKindId: ComponentKindId): ComponentKind | undefined {
    return this.componentKindIdToComponentKind.get(componentKindId);
  }
  getComponentKindIds(): Iterable<ComponentKindId> {
    return this.componentKindIdToComponentKind.keys();
  }
  registerType<T extends Serializable>(ctor: {new():T}, componentKind: ComponentKind): ComponentKindId {
    let componentKindId = this.getComponentKindId(componentKind);
    this.componentKindIdToComponentKind.set(componentKindId, componentKind);
    this.componentKindIdToComponentDataConstructor.set(componentKindId, ctor);
    this.componentDataConstructorToComponentKindId.set(ctor, componentKindId);
    this.componentKindIdToComponentFactory.set(componentKindId, (
      kindId: ComponentKindId,
      id: ComponentId,
      ownerId: EntityId,
      data: T) => new ComponentImpl<T>(kindId, id, ownerId, data)
    );
    return componentKindId;
  }
  constructComponentData(componentKindId: ComponentKindId) {
    return new (this.componentKindIdToComponentDataConstructor.get(componentKindId)!) ();
  }
  constructComponent(
    componentKindId: ComponentKindId,
    id: ComponentId,
    ownerId: EntityId) {
    let data = new (this.componentKindIdToComponentDataConstructor.get(componentKindId)!) ();
    return this.constructComponentFromData(componentKindId, id,  ownerId, data);
  }
  constructComponentFromData(
    componentKindId: ComponentKindId,
    id: ComponentId,
    ownerId: EntityId,
    data: any) {
    return this.componentKindIdToComponentFactory.get(componentKindId)!(componentKindId, id, ownerId, data);
  }

  private componentKindIdToComponentKind: Map<ComponentKindId, ComponentKind> = new Map();
  // Following pair are each others inverse
  private componentKindIdToComponentDataConstructor: Map<ComponentKindId, {new():Serializable}> = new Map();
  private componentDataConstructorToComponentKindId: Map<Function, ComponentKindId> = new Map();
  private componentKindIdToComponentFactory: Map<ComponentKindId, GenericComponentFactory> = new Map();
}

class EntityComponentStateImpl implements EntityComponentState {
  constructor(private reflection: ComponentReflection) {
    for(let componentKindId of this.reflection.getComponentKindIds()) {
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

  entityIds: Set<EntityId> = new Set();
  componentKindIdToComponents: Map<ComponentKindId, Map<ComponentId, GenericComponent>> = new Map();
  // redundant state for fast Entity-to-Components lookup
  entityIdToComponents: Map<EntityId, Map<ComponentKindId, ComponentId>> = new Map();

  createEntity(components?: Serializable[], entityId?: EntityId): Entity {
    // TODO This function probably needs to be more transactional
    let newEntityId = entityId !== undefined ? entityId : this.getNextEntityId();
    this.entityIds.add(newEntityId);
    this.entityIdToComponents.set(newEntityId, new Map());
    if(components !== undefined) {
      for(let component of components) {
        this.createGenericComponent(newEntityId, component);
      }
    }
    return new EntityImpl(newEntityId, this);
  }

  createGenericComponent(ownerId: EntityId, data: Serializable): GenericComponent {
    let newComponentId = this.getNextComponentId();
    let componentKindId = this.reflection.getComponentKindIdFromConstructor(data.constructor)!;
    let componentHandle = this.reflection.constructComponentFromData(
      componentKindId,
      newComponentId,
      ownerId,
      data);
    this.addComponent(componentHandle);
    return componentHandle;
  }

  createComponent<T extends Serializable>(ownerId: EntityId, data: T): Component<T> {
    return this.createGenericComponent(ownerId, data) as Component<T>;
  }

  removeEntity(entityId: EntityId): void {
    throw new Error("Unimplemented");
  }

  removeComponent(componentId: ComponentId): void {
    throw new Error("Unimplemented");
  }

  *getAllComponents(): Iterable<GenericComponent> {
    for(let componentMap of this.componentKindIdToComponents.values()) {
      yield* componentMap.values();
    }
  }

  private _getComponents<T extends Serializable>(componentType: {new():T}): Map<ComponentId, Component<T>> | undefined {
    return this.componentKindIdToComponents.get(
      this.reflection.getComponentKindIdFromConstructor(componentType)!
    ) as Map<ComponentId, Component<T>> | undefined;
  }

  getComponents<T extends Serializable>(componentType: {new():T}): Iterable<Component<T>> {
    return this._getComponents(componentType)!.values();
  }

  getGenericComponent(componentKind: ComponentKind, componentId: ComponentId): GenericComponent | undefined {
    return this.getComponentsByKindId(this.reflection.getComponentKindId(componentKind)).get(componentId);
  }

  getComponent<T extends Serializable>(componentType: {new():T}, componentId: ComponentId): Component<T> | undefined {
    let componentsOfKind = this._getComponents(componentType);
    if (componentsOfKind === undefined) {
      return undefined;
    }
    return componentsOfKind.get(componentId);
  }

  getComponentOfEntity<T extends Serializable>(componentType: {new():T}, entityId: EntityId): Component<T> | undefined {
    let maybeEntityComponents = this.entityIdToComponents.get(entityId);
    if (maybeEntityComponents === undefined) {
      return undefined;
    }
    let maybeComponentId = maybeEntityComponents.get(this.reflection.getComponentKindIdFromConstructor(componentType)!);
    if (maybeComponentId === undefined) {
      return undefined;
    }
    return this.getComponent(componentType, maybeComponentId);
  }

  *getComponentsOfEntity(entityId: EntityId): Iterable<GenericComponent> | undefined {
    let maybeEntityComponents = this.entityIdToComponents.get(entityId);
    if (maybeEntityComponents === undefined) {
      return undefined;
    }
    for(let [kindId, id] of maybeEntityComponents.entries()) {
      let componentsOfKind = this.getComponentsByKindId(kindId);
      yield componentsOfKind.get(id)!;
    }
  }

  // TODO !!!! this relies on insertion order and might break down on the client
  // when we change networking
  *getAspect<T extends Serializable, U extends Serializable>(
    componentTypeT: {new():T},
    componentTypeU: {new():U}): Iterable<[Component<T>, Component<U>]> | undefined {
    let componentTypeIdT = this.reflection.getComponentKindIdFromConstructor(componentTypeT)!;
    let componentTypeIdU = this.reflection.getComponentKindIdFromConstructor(componentTypeU)!;
    let componentsOfKindT = this.getComponents<T>(componentTypeT);
    let componentsOfKindU = this.getComponents<U>(componentTypeU);
    if (componentsOfKindT === undefined || componentsOfKindU === undefined) {
      return undefined;
    }
    let generatorT = componentsOfKindT[Symbol.iterator]();
    let generatorU = componentsOfKindU[Symbol.iterator]();
    let iteratorT = generatorT.next();
    let iteratorU = generatorU.next();
    for(let entityComponents of this.entityIdToComponents.values()) {
      let hasT = entityComponents.has(componentTypeIdT);
      let hasU = entityComponents.has(componentTypeIdU);
      if(hasT && hasU) {
        yield [iteratorT.value, iteratorU.value];
      }
      if(hasT) {
        iteratorT = generatorT.next();
      }
      if(hasU) {
        iteratorU = generatorU.next();
      }
    }
  }

  getEntity(entityId: EntityId): Entity | undefined {
    if(this.entityIds.has(entityId)) {
      return new EntityImpl(entityId, this);
    }
    return undefined;
  }

  // Will get existing or new entry
  getComponentsByKindId(componentKindId: ComponentKindId): Map<ComponentId, GenericComponent> {
    let maybeComponents = this.componentKindIdToComponents.get(componentKindId);
    if(maybeComponents !== undefined) {
      return maybeComponents;
    }
    let newComponents: Map<ComponentId, GenericComponent> = new Map();
    this.componentKindIdToComponents.set(componentKindId, newComponents);
    return newComponents;
  }

  addComponent(component: GenericComponent) {
    this.entityIdToComponents.get(component.getOwnerId())!.set(component.getKindId(), component.getId());
    this.getComponentsByKindId(component.getKindId()).set(component.getId(), component);
  }

  serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'lastEntityId');
    stream.serializeUint32(this, 'lastComponentId');
    let entityIdsLengthObj = {val: this.entityIds.size};
    stream.serializeUint32(entityIdsLengthObj, 'val');
    let ids8Buffer = {val: new Uint8Array(0)};
    if(stream.isWriting) {
      let ids32Buffer = Uint32Array.from(this.entityIds);
      ids8Buffer = {val: new Uint8Array(ids32Buffer.buffer)};
    }
    stream.serializeUint8Array(ids8Buffer, 'val');
    if(stream.isReading) {
      let ids32Buffer = new Uint32Array(ids8Buffer.val);
      this.entityIds = new Set(ids32Buffer);
      for(let entityId of this.entityIds) {
        this.entityIdToComponents.set(entityId, new Map());
      }
    }

    let componentsLengthObj = {val:0};
    if(stream.isWriting) {
      componentsLengthObj.val = Array.from(this.componentKindIdToComponents.values()).reduce(
        (acc: number, item) => {
          return acc + item.size;
        },
        0);
    }
    stream.serializeUint32(componentsLengthObj, 'val');
    if(stream.isWriting) {
      for(let componentIdToComponent of this.componentKindIdToComponents.values()) {
        for(let component of componentIdToComponent.values()) {
          let kindId = {val:component.getKindId()};
          stream.serializeUint32(kindId, 'val');
          component.serialize(stream);
        }
      }
    } else {
      for(let i = 0; i < componentsLengthObj.val; ++i) {
        let kindId = {val:0};
        stream.serializeUint32(kindId, 'val');
        // TODO revisit the need to provide id params up front to the component constructor.
        let component = this.reflection.constructComponent(kindId.val, 0, 0);
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
  getId(): EntityId {
    return this.id;
  }
  getComponent<T extends Serializable>(componentType: {new():T}): Component<T> | undefined {
    return this.ecState.getComponentOfEntity<T>(componentType, this.id);
  }
}

// TODO perhaps rename Engine to Simulator? Move to separate file, the rest of stuff in here is "State"
class EngineImpl implements Engine
{
  private reflection = new ComponentReflection();
  private systems: System[] = [];
  private buttonsEnum?: NumericEnum;

  registerComponentType<T extends Serializable>(componentType: {new(): T}, componentKind: ComponentKind) {
    this.reflection.registerType(componentType, componentKind);
  }

  registerButtons(buttonsEnum: NumericEnum): void {
    this.buttonsEnum = buttonsEnum;
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }
  removeSystem(system: System) {
    this.systems = this.systems.filter(s => s !== system)
  }

  createState() : EntityComponentState {
    return new EntityComponentStateImpl(this.reflection);
  }

  createSimulationFrame() : SimluationFrameData {
    let state = new EntityComponentStateImpl(this.reflection);
    let inputs = new Map<PlayerId, InputFrame>();
    let frame = new SimluationFrameData(-1, 0, inputs, state);
    return frame;
  }

  createInputFrameFromDownButtons(downButtons: Set<number>): InputFrame {
    return createInputFrameFromDownButtons(this.buttonsEnum!, downButtons);
  }

  copySimulationState(src: EntityComponentState, dst: EntityComponentState) : void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  stepSimulation(timeDeltaS: number, previousFrame: SimluationFrameData, nextFrame: SimluationFrameData): void {
    nextFrame.simulationFrameIndex = previousFrame.simulationFrameIndex + 1;
    nextFrame.simulationTimeS = previousFrame.simulationTimeS + timeDeltaS;
    this.copySimulationState(previousFrame.state, nextFrame.state);
    let stepParams: StepParams = {
      simulationTimeS: nextFrame.simulationTimeS,
      timeDeltaS: timeDeltaS,
      inputs: nextFrame.inputs,
      state: nextFrame.state,
      previousFrameInputs: previousFrame.inputs,
      previousFrameState: previousFrame.state,
      previousFrameSimulationTimeS: previousFrame.simulationTimeS,
    };
    this.systems.forEach(s => s.Step(stepParams));
  }
}
