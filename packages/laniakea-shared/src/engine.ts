import {
  InputFrame,
  ContinuousInputKind,
  EventedInputKind
} from './input';
import { ClassRegistry } from './reflection';
import {
  SerializationStream,
  Serializable,
  measureAndSerialize,
  ReadStream
} from './serialization';
import { EntityComponentState, EntityComponentStateImpl, ComponentKind, ComponentReflection } from './state';


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
  // Input Registration
  /**
   * Continuous input remains the same on the server if it doesnt get an update from client.
   * Good for things like player movement instructions from inputs that are held down by the player.
   */
  registerContinuousInputType<T extends Serializable>(inputType: {new():T}, inputKind: ContinuousInputKind): void

  /**
   * Evented input has reliable and ordered delivery, and does not persist beyond the frame it is processed in.
   * Good for things like shooting a single projectile in a target direction, putting points in a stat.
   */
  registerEventedInputType<T extends Serializable>(inputType: {new():T}, inputKind: EventedInputKind): void

  // State Registration
  registerComponentType<T extends Serializable>(componentType: {new():T}, componentKind: ComponentKind): void;

  // System Registration
  addSystem(system: System): void;
  removeSystem(system: System): void;

  // Input + State utils
  createInputFrame(): InputFrame;
  copyInputFrame(src: InputFrame, dst: InputFrame) : void;
  createState() : EntityComponentState;
  copySimulationState(src: EntityComponentState, dst: EntityComponentState) : void;
  createSimulationFrame() : SimluationFrameData;

  /**
   * Runs 1 simulation step with duration of timeDeltaS to produce nextFrame from previousFrame
   * using the simulation provided by the registered systems.
   */
  stepSimulation(timeDeltaS: number, previousFrame: SimluationFrameData, nextFrame: SimluationFrameData): void;
}

export function createEngine(): Engine {
  return new EngineImpl();
}

class EngineImpl implements Engine
{
  private continuousInputTypes = new ClassRegistry();
  private componentReflection = new ComponentReflection();
  private systems: System[] = [];

  registerContinuousInputType<T extends Serializable>(inputType: {new():T}, inputKind: ContinuousInputKind): void {
    this.continuousInputTypes.registerClass(inputType, inputKind);
  }

  registerEventedInputType<T extends Serializable>(inputType: {new():T}, inputKind: EventedInputKind): void {
    throw new Error("Unimplemented");
  }

  registerComponentType<T extends Serializable>(componentType: {new(): T}, componentKind: ComponentKind) {
    this.componentReflection.registerType(componentType, componentKind);
  }

  addSystem(system: System): void {
    this.systems.push(system);
  }
  removeSystem(system: System) {
    this.systems = this.systems.filter(s => s !== system)
  }

  createInputFrame(): InputFrame {
    return new InputFrame(this.continuousInputTypes);
  }

  copyInputFrame(src: InputFrame, dst: InputFrame) : void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  createState() : EntityComponentState {
    return new EntityComponentStateImpl(this.componentReflection);
  }

  copySimulationState(src: EntityComponentState, dst: EntityComponentState) : void {
    let serialized = measureAndSerialize(src);
    let readStream = new ReadStream(new DataView(serialized));
    dst.serialize(readStream);
  }

  createSimulationFrame() : SimluationFrameData {
    let state = new EntityComponentStateImpl(this.componentReflection);
    let inputs = new Map<PlayerId, InputFrame>();
    let frame = new SimluationFrameData(-1, 0, inputs, state);
    return frame;
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
