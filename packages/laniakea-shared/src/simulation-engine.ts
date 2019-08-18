import { ClassRegistry, TypeInfo, TypeName } from './class-registry';
import { InputFrame } from './input';
import { measureAndSerialize, ReadStream, Serializable } from './serialization';
import { EntityComponentState, EntityComponentStateImpl } from './state';
import { ComponentTypeId } from './ids';
import { DeletedTag } from './entity-component-db';
import { StepParams, PlayerId, System } from './engine';

export class SimulationFrameData {
  constructor(
    public simulationFrameIndex: number,
    public simulationTimeS: number,
    public inputs: Map<PlayerId, InputFrame>,
    public state: EntityComponentState) {
    }
}

/**
 * Provides simulation management that is shared by both client and server
 */
export class SimulationEngine {
  /**
   *
   * @param classRegistry A ClassRegistry that will be used for serialization and typeIds,
   * should be synced between server and client for state to be networked correctly.
   */
  constructor(private classRegistry: ClassRegistry) {
    this.registerComponentType(DeletedTag, '__DeletedTag');
  }

  public createSimulationFrame(): SimulationFrameData {
    let state = new EntityComponentStateImpl(this.componentTypes.map((ti) => ti.shortTypeId), this.classRegistry);
    let inputs = new Map<PlayerId, InputFrame>();
    let frame = new SimulationFrameData(-1, 0, inputs, state);
    return frame;
  }

  public cloneSimulationFrame(src: SimulationFrameData): SimulationFrameData {
    let clone = this.createSimulationFrame();
    clone.simulationFrameIndex = src.simulationFrameIndex;
    clone.simulationTimeS = src.simulationTimeS;
    this.copySimulationState(src.state, clone.state);
    return clone;
  }

  //#region Input

  /**
   * See [[Engine.registerContinuousInputType]]
   */
  public registerContinuousInputType<T extends Serializable>(inputType: new() => T, inputTypeName: TypeName): void {
    let typeInfo = this.classRegistry.registerClass(inputType, inputTypeName);
    this.continuousInputTypes.push(typeInfo);
  }

  /**
   * TODO Implement evented input
   * Evented input has reliable and ordered delivery, and does not persist beyond the frame it is processed in.
   * Good for things like shooting a single projectile in a target direction, putting points in a stat.
   */
  //

  public createInputFrame(): InputFrame {
    return new InputFrame(this.continuousInputTypes, this.classRegistry);
  }

  public copyInputFrame(src: InputFrame, dst: InputFrame): void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  //#endregion

  //#region State

  public registerComponentType<T extends Serializable>(componentType: new() => T, componentTypeName: TypeName): void {
    let typeInfo = this.classRegistry.registerClass(componentType, componentTypeName);
    this.componentTypes.push(typeInfo);
  }

  public constructComponentData(componentTypeId: ComponentTypeId): Serializable {
    return this.classRegistry.getTypeInfoByShortTypeId(componentTypeId)!.construct() as Serializable;
  }

  public copySimulationState(src: EntityComponentState, dst: EntityComponentState): void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  //#endregion

  //#region System Registration

  public addSystem(system: System): void {
    this.systems.push(system);
  }

  public removeSystem(system: System): void {
    this.systems = this.systems.filter((s) => s !== system);
  }

  //#endregion

  /**
   * Runs 1 simulation step with duration of timeDeltaS to produce nextFrame from previousFrame
   * using the simulation provided by the registered systems.
   */
  public stepSimulation(timeDeltaS: number, previousFrame: SimulationFrameData, nextFrame: SimulationFrameData): void {
    nextFrame.simulationFrameIndex = previousFrame.simulationFrameIndex + 1;
    nextFrame.simulationTimeS = previousFrame.simulationTimeS + timeDeltaS;
    this.copySimulationState(previousFrame.state, nextFrame.state);
    let stepParams: StepParams = {
      timeDeltaS,
      simulationTimeS: nextFrame.simulationTimeS,
      inputs: nextFrame.inputs,
      state: nextFrame.state.withDeletedStateHidden(),
      previousFrameSimulationTimeS: previousFrame.simulationTimeS,
      previousFrameInputs: previousFrame.inputs,
      previousFrameState: previousFrame.state.withDeletedStateHidden(),
    };
    this.systems.forEach((s) => s.Step(stepParams));
  }

  private continuousInputTypes = new Array<TypeInfo>();
  private componentTypes = new Array<TypeInfo>();
  private systems: System[] = [];
}
