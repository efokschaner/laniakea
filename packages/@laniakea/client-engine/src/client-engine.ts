import {
  C2S_InputFrameMessage,
  ClassRegistry,
  Engine,
  InputFrame,
  measureAndSerialize,
  periodicCallback,
  PeriodicCallbackHandle,
  PlayerId,
  registerMessageTypes,
  S2C_FrameComponentStateMessage,
  S2C_FrameDeletionsMessage,
  S2C_FrameInputsUsedMessage,
  SequenceNumber,
  Serializable,
  SimulationEngine,
  System,
  TypeName,
} from '@laniakea/base-engine';
import { NetworkClient } from '@laniakea/network-client';
import { SyncEvent } from 'ts-events';
import { ClientSimulation } from './client-simulation';
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

/**
 * The main class for game clients.
 * Brings together all the client-side systems in the engine.
 */
export class ClientEngine implements Engine {
  public static defaultOptions: ClientEngineOptions = {
    simFPS: 30,
    globalSimulationRateMultiplier: 1.0,
    secondsOfSimulationFramesToRetain: 2,
  };
  public options: ClientEngineOptions;

  public constructor(options: Partial<ClientEngineOptions>) {
    this.options = Object.assign({}, ClientEngine.defaultOptions, options);
    this.networkClient = new NetworkClient(this.classRegistry);
    this.serverTimeEstimator = new ServerTimeEstimator(
      this.networkClient,
      this.options.globalSimulationRateMultiplier
    );
    this.clientSimulation = new ClientSimulation(
      this.options.secondsOfSimulationFramesToRetain,
      this.options.simFPS,
      this.serverTimeEstimator,
      this.simulationEngine
    );
    registerMessageTypes(
      this.networkClient.registerMessageType.bind(this.networkClient)
    );
    this.networkClient.registerMessageHandler(
      S2C_FrameInputsUsedMessage,
      this.clientSimulation.onFrameInputsUsedMessage.bind(this.clientSimulation)
    );
    this.networkClient.registerMessageHandler(
      S2C_FrameComponentStateMessage,
      this.clientSimulation.onFramecomponentStateMessage.bind(
        this.clientSimulation
      )
    );
    this.networkClient.registerMessageHandler(
      S2C_FrameDeletionsMessage,
      this.clientSimulation.onFrameDeletionsMessage.bind(this.clientSimulation)
    );
    this.networkClient.onConnected.attach((playerId) => {
      this.playerId = playerId;
      this.clientSimulation.onPlayerIdAssigned(playerId);
      this.onConnectedToServer.post(playerId);
    });
  }

  public registerContinuousInputType<T extends Serializable>(
    inputType: new () => T,
    inputTypeName: TypeName
  ): void {
    this.simulationEngine.registerContinuousInputType(inputType, inputTypeName);
  }

  public registerComponentType<T extends Serializable>(
    componentType: new () => T,
    componentTypeName: TypeName
  ): void {
    this.simulationEngine.registerComponentType(
      componentType,
      componentTypeName
    );
    // TODO. If we want to support adding a component type after we have started to create simulation frames,
    // we'll need to rebuild all the frames here
    // For now we'll just assume all components are registered prior to connecting to the server.
  }

  public addSystem(system: System): void {
    this.simulationEngine.addSystem(system);
  }

  public removeSystem(system: System): void {
    this.simulationEngine.removeSystem(system);
  }

  public getCurrentContinuousInput<T extends Serializable>(
    inputType: new () => T
  ): T | undefined {
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
  public connectToServer(serverWsUrl: string): Promise<void> {
    return this.networkClient.connect(serverWsUrl);
  }

  public onConnectedToServer = new SyncEvent<PlayerId>();

  public setRenderingSystem(s: RenderingSystem): void {
    this.renderingSystem = s;
  }

  public start(): void {
    this.currentInputFrame = this.simulationEngine.createInputFrame();
    this.updateServerTimeEstimatorHandle = periodicCallback(
      this.serverTimeEstimator.update.bind(this.serverTimeEstimator),
      50,
      'updateServerTimeEstimator'
    );
    this.animationFrameReqeuestHandle = requestAnimationFrame(
      this.renderLoop.bind(this)
    );
    this.updateInputHandle = periodicCallback(
      this.updateInput.bind(this),
      1000 / 60,
      'updateInputHandler'
    );
    this.fallbackClientSimulationHandle = periodicCallback(
      this.fallbackClientSimulation.bind(this),
      1000,
      'fallbackClientSimulation'
    );
  }

  public stop(): void {
    this.fallbackClientSimulationHandle!.stop();
    this.updateInputHandle!.stop();
    cancelAnimationFrame(this.animationFrameReqeuestHandle!);
    this.updateServerTimeEstimatorHandle!.stop();
  }

  public playerId?: PlayerId = undefined;
  private classRegistry = new ClassRegistry<Serializable>();

  private readonly simulationEngine = new SimulationEngine(this.classRegistry);
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
    packet.inputFrame = new Uint8Array(
      measureAndSerialize(this.currentInputFrame)
    );
    if (serverSimTimeS !== undefined && inputTravelTime !== undefined) {
      targetSimulationTimeS = serverSimTimeS + inputTravelTime;
      packet.targetSimulationTimeS = targetSimulationTimeS;
    }
    this.networkClient.sendMessage(packet);
    if (targetSimulationTimeS !== undefined) {
      this.clientSimulation.notifyInputBeingSent(
        this.currentInputFrame,
        targetSimulationTimeS
      );
    }
    this.networkClient.flushMessagesToNetwork();
  }

  private renderLoop(domHighResTimestampMS: number) {
    this.animationFrameReqeuestHandle = requestAnimationFrame(
      this.renderLoop.bind(this)
    );
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
