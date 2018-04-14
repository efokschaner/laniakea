import * as Bluebird from 'bluebird';
const present = require('present');
import { SyncEvent, VoidSyncEvent } from 'ts-events';
import {
  createEngine,
  Engine,
  NumericEnum,
  PlayerId,
  ReadStream,
  registerPacketTypes,
  S2C_FrameUpdatePacket
} from 'laniakea-shared';
import { NetworkClient } from './network-client';
import { ServerTimeEstimator } from './server-time-estimator';
import { ClientSimulation } from './client-simulation';
import { ClientInputHandler } from './client-input-handler';

export interface RenderingSystem {
  render(domHighResTimestampMS: number, simulation: ClientSimulation): void;
}

interface PeriodicCallbackHandle {
  stop(): void;
}

function periodicCallback(callback: () => void, periodMS: number, cosmeticName: string) : PeriodicCallbackHandle {
  let nextTimeoutHandle: NodeJS.Timer;
  let callbackWrapper = () => {
    let startTimeMS = present();
    try {
      callback();
    } catch (e) {
      console.error(`Exception from ${cosmeticName} callback`);
      console.error(e, e.stack);
    }
    let endTimeMS = present();
    let durationMS = startTimeMS - endTimeMS;
    let timeToNextCallMS = periodMS - durationMS;
    if(timeToNextCallMS < 0) {
      console.warn(`${cosmeticName} callback took longer than period. periodMS=${periodMS} durationMS=${durationMS}`);
      timeToNextCallMS = 0;
    }
    nextTimeoutHandle = setTimeout(callbackWrapper, timeToNextCallMS);
  };
  nextTimeoutHandle = setTimeout(callbackWrapper, 0);
  return {
    stop() {
      clearTimeout(nextTimeoutHandle);
    }
  }
}

export interface ClientEngineOptions {
  simFPS: number;
  secondsOfSimulationFramesToRetain: number;
}

// TODO, probably in concert with renaming "Engine"
// Have ClientEngine and ServerEngine share an interface, probably called Engine.
// Interface allows common configuration / registration code across client and server.
export class ClientEngine {
  static defaultOptions: ClientEngineOptions = {
    simFPS: 30,
    secondsOfSimulationFramesToRetain: 2
  };
  options: ClientEngineOptions;

  constructor(options: Partial<ClientEngineOptions>) {
    this.options = Object.assign({}, ClientEngine.defaultOptions, options);
    this.clientSimulation = new ClientSimulation(
      this.options.secondsOfSimulationFramesToRetain,
      this.options.simFPS,
      this.serverTimeEstimator,
      this.engine);
    this.inputHandler = new ClientInputHandler(
      this.serverTimeEstimator,
      this.clientSimulation,
      this.networkClient);

    registerPacketTypes(this.networkClient.registerPacketType.bind(this.networkClient));
    this.networkClient.registerPacketHandler(
      S2C_FrameUpdatePacket,
      this.clientSimulation.onFrameUpdatePacket.bind(this.clientSimulation)
    );
    this.networkClient.onConnected.attach((playerId) => {
      this.playerId = playerId;
      this.clientSimulation.onPlayerIdAssigned(playerId);
      this.onConnectedToServer.post(playerId);
    });
  }

  /**
   * TODO, given we have determined it's unreasonable to expect a running ClientEngine
   * to switch between server + serverless modes, we should consider passing the server info in to the constructor.
   * @param serverWsUrl
   */
  public connectToServer(serverWsUrl: string): Bluebird<void> {
    return this.networkClient.connect(serverWsUrl);
  }

  public onConnectedToServer = new SyncEvent<PlayerId>();

  public setRenderingSystem(s: RenderingSystem) {
    this.renderingSystem = s;
  }

  /**
   * TODO, replace input "buttons" with a component style registration of continuous and evented inputs
   * Continuous: server assumes input remains the same if it doesnt get an update from client.
   * Evented: guaranteed once delivery, and only happens on a single frame.
   * Move the buttons code that exists into a "stock" Buttons Input Component or something
   */
  /**
   * Used to register the button-style inputs that will be networked for the game.
   *
   * @param buttonsEnum either a TypeScript enum of an object of string keys to numeric values
   * that describes the button-style inputs you support in a keyboard-agnostic form. See buttonMappingCallback
   * for converting actual keyboard keys into the key-agnostic button.
   *
   * @param buttonMappingCallback accepts https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
   * should return a value from your buttonsEnum or undefined if the button is not used.
   */
  public registerInputButtons(
    buttonsEnum: any,
    buttonMappingCallback: (keyboardKey: string) => number | undefined): void {
    this.engine.registerButtons(buttonsEnum);
    this.inputHandler.registerButtons(buttonsEnum, buttonMappingCallback);
  }

  public start() {
    this.updateServerTimeEstimatorHandle = periodicCallback(this.serverTimeEstimator.update.bind(this.serverTimeEstimator), 50, 'updateServerTimeEstimator');
    this.animationFrameReqeuestHandle = requestAnimationFrame(this.renderLoop.bind(this));
    this.updateInputHandlerHandle = periodicCallback(this.updateInputHandler.bind(this), 1000 / 60, 'updateInputHandler');
    this.fallbackClientSimulationHandle = periodicCallback(this.fallbackClientSimulation.bind(this), 1000, 'fallbackClientSimulation');
  }

  public stop() {
    this.fallbackClientSimulationHandle!.stop();
    this.updateInputHandlerHandle!.stop();
    cancelAnimationFrame(this.animationFrameReqeuestHandle!);
    this.updateServerTimeEstimatorHandle!.stop();
  }

  public playerId?: PlayerId = undefined;

  // TODO make private
  public readonly engine = createEngine();

  private networkClient = new NetworkClient();
  private serverTimeEstimator = new ServerTimeEstimator(this.networkClient);
  private clientSimulation: ClientSimulation;
  private inputHandler: ClientInputHandler;
  private renderingSystem?: RenderingSystem;
  private updateServerTimeEstimatorHandle?: PeriodicCallbackHandle;
  private animationFrameReqeuestHandle?: number;
  private updateInputHandlerHandle?: PeriodicCallbackHandle;
  private fallbackClientSimulationHandle?: PeriodicCallbackHandle;

  private updateInputHandler() {
    this.inputHandler.update();
  }

  private renderLoop(domHighResTimestampMS: number) {
    this.animationFrameReqeuestHandle = requestAnimationFrame(this.renderLoop.bind(this));
    if (this.renderingSystem) {
      this.renderingSystem.render(domHighResTimestampMS, this.clientSimulation);
    }
  }

  /**
   * The purpose of this is to provide some ticking of the simulation system
   * even when the renderer isn't, to guard against too much simulation work building up.
   * If the renderer is using the simulation there should be almost no work to do here.
   * Most browsers appear to stop servicing requestAnimationFrame when there is
   * no focus and so by doing this we avoid the simulation pausing.
   * Browsers also limit the fastest setTimeout to about 1s so there's no point having this
   * in a loop tighter than 1s. Literature reports 1 second my testing in latest Chrome
   * shows 2 seconds even.
   */
  private fallbackClientSimulation() {
    let currentSimTimeS = this.clientSimulation.getCurrentSimulationTimeS();
    let inputTravelTimeS = this.clientSimulation.getInputTravelTimeS();
    if(currentSimTimeS === undefined || inputTravelTimeS === undefined) {
      return;
    }
    // targetSimTimeS is selected to do minimal extrapolation in this fallback case
    let targetSimTimeS = currentSimTimeS - inputTravelTimeS;
    this.clientSimulation.doSimulationWork(targetSimTimeS);
  }
}