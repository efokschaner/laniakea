import { TypeName } from './class-registry';
import { InputFrame } from './input';
import { NominalType } from './nominal-type';
import { Serializable } from './serialization';
import { EntityComponentState } from './state';

export type PlayerId = NominalType<number, 'PlayerId'>;

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

/**
 * The Engine interface that is common to both client and server engine.
 */
export interface Engine {
  /**
   * Continuous input remains the same on the server if it doesnt get an update from client.
   * Good for things like player movement instructions from inputs that are held down by the player.
   */
  registerContinuousInputType<T extends Serializable>(inputType: new() => T, inputTypeName: TypeName): void;

  registerComponentType<T extends Serializable>(componentType: new() => T, componentTypeName: TypeName): void;

  addSystem(system: System): void;
  removeSystem(system: System): void;

}
