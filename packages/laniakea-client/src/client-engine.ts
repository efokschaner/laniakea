import * as Bluebird from 'bluebird';
import {
  C2S_InputFrameMessage,
  ContinuousInputKind,
  createEngine,
  Engine,
  InputFrame,
  measureAndSerialize,
  PlayerId,
  periodicCallback,
  PeriodicCallbackHandle,
  registerMessageTypes,
  S2C_FrameUpdateMessage,
  Serializable,
  SequenceNumber,
} from 'laniakea-shared';
import { SyncEvent } from 'ts-events';
import { ClientSimulation } from './client-simulation';
import { NetworkClient } from './network-client';
import { ServerTimeEstimator } from './server-time-estimator';

export interface RenderingSystem {
  render(domHighResTimestampMS: number, simulation: ClientSimulation): void;
}

export interface ClientEngineOptions {
  simFPS: number;
  // TODO drive this value from server
  globalSimulationRateMultiplier: number;
  secondsOfSimulationFramesToRetain: number;
}

// TODO, probably in concert with renaming "Engine"
// Have ClientEngine and ServerEngine share an interface, probably called Engine.
// Interface allows common configuration / registration code across client and server.
export class ClientEngine {
  public static defaultOptions: ClientEngineOptions = {
    simFPS: 30,
    globalSimulationRateMultiplier: 1.0,
    secondsOfSimulationFramesToRetain: 2,
  };
  public options: ClientEngineOptions;

  constructor(options: Partial<ClientEngineOptions>) {
    this.options = Object.assign({}, ClientEngine.defaultOptions, options);
    this.networkClient = new NetworkClient();
    this.serverTimeEstimator = new ServerTimeEstimator(this.networkClient, this.options.globalSimulationRateMultiplier);
    this.clientSimulation = new ClientSimulation(
      this.options.secondsOfSimulationFramesToRetain,
      this.options.simFPS,
      this.serverTimeEstimator,
      this.engine);
    registerMessageTypes(this.networkClient.registerMessageType.bind(this.networkClient));
    this.networkClient.registerMessageHandler(
      S2C_FrameUpdateMessage,
      this.clientSimulation.onFrameUpdateMessage.bind(this.clientSimulation),
    );
    this.networkClient.onConnected.attach((playerId) => {
      this.playerId = playerId;
      this.clientSimulation.onPlayerIdAssigned(playerId);
      this.onConnectedToServer.post(playerId);
    });
  }

  public registerContinuousInputType<T extends Serializable>(inputType: new() => T, inputKind: string): void {
    this.engine.registerContinuousInputType(inputType, inputKind as ContinuousInputKind);
  }

  public getCurrentContinuousInput<T extends Serializable>(inputType: new() => T): T|undefined {
    if (this.currentInputFrame === undefined) {
      return undefined;
    }
    return this.currentInputFrame.getContinuousInput(inputType);
  }

  /**
   * TODO, given we have determined it's unreasonable to expect ClientEngine to handle both
   * server + serverless modes, we should consider passing the server info in to the constructor.
   * @param serverWsUrl
   */
  public connectToServer(serverWsUrl: string): Bluebird<void> {
    return this.networkClient.connect(serverWsUrl);
  }

  public onConnectedToServer = new SyncEvent<PlayerId>();

  public setRenderingSystem(s: RenderingSystem) {
    this.renderingSystem = s;
  }

  public start() {
    this.currentInputFrame = this.engine.createInputFrame();
    this.updateServerTimeEstimatorHandle = periodicCallback(this.serverTimeEstimator.update.bind(this.serverTimeEstimator), 50, 'updateServerTimeEstimator');
    this.animationFrameReqeuestHandle = requestAnimationFrame(this.renderLoop.bind(this));
    this.updateInputHandle = periodicCallback(this.updateInput.bind(this), 1000 / 60, 'updateInputHandler');
    this.fallbackClientSimulationHandle = periodicCallback(this.fallbackClientSimulation.bind(this), 1000, 'fallbackClientSimulation');
  }

  public stop() {
    this.fallbackClientSimulationHandle!.stop();
    this.updateInputHandle!.stop();
    cancelAnimationFrame(this.animationFrameReqeuestHandle!);
    this.updateServerTimeEstimatorHandle!.stop();
  }

  public playerId?: PlayerId = undefined;

  // TODO make private
  public readonly engine: Engine = createEngine();

  private networkClient: NetworkClient;
  private serverTimeEstimator: ServerTimeEstimator;
  public readonly clientSimulation: ClientSimulation;
  private currentInputFrame?: InputFrame;
  private renderingSystem?: RenderingSystem;
  private updateServerTimeEstimatorHandle?: PeriodicCallbackHandle;
  private animationFrameReqeuestHandle?: number;
  private updateInputHandle?: PeriodicCallbackHandle;
  private fallbackClientSimulationHandle?: PeriodicCallbackHandle;

  private nextOutboundSequenceNumber = new SequenceNumber(0);
  private getNextOutboundSequenceNumber(): SequenceNumber {
    let ret = this.nextOutboundSequenceNumber;
    this.nextOutboundSequenceNumber = this.nextOutboundSequenceNumber.add(1);
    return ret;
  }

  private updateInput() {
    if (this.currentInputFrame === undefined) {
      return;
    }
    let serverSimTimeS = this.clientSimulation.getCurrentSimulationTimeS();
    let inputTravelTime = this.clientSimulation.getInputTravelTimeS();
    let targetSimulationTimeS: number | undefined;
    let packet = new C2S_InputFrameMessage();
    packet.sequenceNumber = this.getNextOutboundSequenceNumber();
    packet.inputFrame = new Uint8Array(measureAndSerialize(this.currentInputFrame));
    if (serverSimTimeS !== undefined && inputTravelTime !== undefined) {
      targetSimulationTimeS = serverSimTimeS + inputTravelTime;
      packet.targetSimulationTimeS = targetSimulationTimeS;
    }
    this.networkClient.sendMessage(packet);
    if (targetSimulationTimeS !== undefined) {
      this.clientSimulation.notifyInputBeingSent(this.currentInputFrame, targetSimulationTimeS);
    }
    this.networkClient.flushMessagesToNetwork();
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
    if (currentSimTimeS === undefined || inputTravelTimeS === undefined) {
      return;
    }
    // targetSimTimeS is selected to do minimal extrapolation in this fallback case
    let targetSimTimeS = currentSimTimeS - inputTravelTimeS;
    this.clientSimulation.doSimulationWork(targetSimTimeS);
  }
}
