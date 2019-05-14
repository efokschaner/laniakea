import {
  ContinuousInputKind,
  EventedInputKind,
  InputFrame,
} from './input';
import { ClassRegistry } from './reflection';
import {
  measureAndSerialize,
  ReadStream,
  Serializable,
} from './serialization';
import { ComponentKind, ComponentReflection, EntityComponentState, EntityComponentStateImpl } from './state';

export enum _PlayerIdBrand {}
export type PlayerId = number & _PlayerIdBrand;

export class SimluationFrameData {
  constructor(
    public simulationFrameIndex: number,
    public simulationTimeS: number,
    public inputs: Map<PlayerId, InputFrame>,
    public state: EntityComponentState) {
    }
}

export interface StepParams {
  timeDeltaS: number;
  simulationTimeS: number;
  inputs: Map<PlayerId, InputFrame>;
  state: EntityComponentState;
  previousFrameSimulationTimeS: number;
  previousFrameInputs: Map<PlayerId, InputFrame>;
  previousFrameState: EntityComponentState;
}

export interface System {
  Step(stepParams: StepParams): void;
}

export interface Engine {
  // Input Registration
  /**
   * Continuous input remains the same on the server if it doesnt get an update from client.
   * Good for things like player movement instructions from inputs that are held down by the player.
   */
  registerContinuousInputType<T extends Serializable>(inputType: new() => T, inputKind: ContinuousInputKind): void;

  /**
   * Evented input has reliable and ordered delivery, and does not persist beyond the frame it is processed in.
   * Good for things like shooting a single projectile in a target direction, putting points in a stat.
   */
  registerEventedInputType<T extends Serializable>(inputType: new() => T, inputKind: EventedInputKind): void;

  // State Registration
  registerComponentType<T extends Serializable>(componentType: new() => T, componentKind: ComponentKind): void;

  // System Registration
  addSystem(system: System): void;
  removeSystem(system: System): void;

  // Input + State utils
  createInputFrame(): InputFrame;
  copyInputFrame(src: InputFrame, dst: InputFrame): void;
  createState(): EntityComponentState;
  copySimulationState(src: EntityComponentState, dst: EntityComponentState): void;
  createSimulationFrame(): SimluationFrameData;

  /**
   * Runs 1 simulation step with duration of timeDeltaS to produce nextFrame from previousFrame
   * using the simulation provided by the registered systems.
   */
  stepSimulation(timeDeltaS: number, previousFrame: SimluationFrameData, nextFrame: SimluationFrameData): void;
}

export function createEngine(): Engine {
  return new EngineImpl();
}

class EngineImpl implements Engine {
  private continuousInputTypes = new ClassRegistry();
  private componentReflection = new ComponentReflection();
  private systems: System[] = [];

  public registerContinuousInputType<T extends Serializable>(inputType: new() => T, inputKind: ContinuousInputKind): void {
    this.continuousInputTypes.registerClass(inputType, inputKind);
  }

  public registerEventedInputType<T extends Serializable>(_inputType: new() => T, _inputKind: EventedInputKind): void {
    throw new Error('Unimplemented');
  }

  public registerComponentType<T extends Serializable>(componentType: new() => T, componentKind: ComponentKind) {
    this.componentReflection.registerType(componentType, componentKind);
  }

  public addSystem(system: System): void {
    this.systems.push(system);
  }
  public removeSystem(system: System) {
    this.systems = this.systems.filter((s) => s !== system);
  }

  public createInputFrame(): InputFrame {
    return new InputFrame(this.continuousInputTypes);
  }

  public copyInputFrame(src: InputFrame, dst: InputFrame): void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  public createState(): EntityComponentState {
    return new EntityComponentStateImpl(this.componentReflection);
  }

  public copySimulationState(src: EntityComponentState, dst: EntityComponentState): void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  public createSimulationFrame(): SimluationFrameData {
    let state = new EntityComponentStateImpl(this.componentReflection);
    let inputs = new Map<PlayerId, InputFrame>();
    let frame = new SimluationFrameData(-1, 0, inputs, state);
    return frame;
  }

  public stepSimulation(timeDeltaS: number, previousFrame: SimluationFrameData, nextFrame: SimluationFrameData): void {
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
}
