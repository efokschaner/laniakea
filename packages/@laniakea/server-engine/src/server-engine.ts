import { AddressInfo } from 'net';
import present = require('present');

import {
  C2S_InputFrameMessage,
  C2S_TimeSyncRequestMessage,
  ClassRegistry,
  ComponentAndSerializedData,
  Engine,
  MeasureStream,
  PlayerId,
  registerMessageTypes,
  S2C_TimeSyncResponseMessage,
  Serializable,
  SimulationEngine,
  SimulationFrameData,
  System,
  TypeName,
  WriteStream,
} from '@laniakea/base-engine';
import {
  AuthCallback,
  ListenOptions,
  NetworkServer,
} from '@laniakea/network-server';
import * as tsEvents from 'ts-events';
import { FrameUpdateSender } from './frame-update-sender';
import { ServerInputHandler } from './server-input-handler';

export interface PlayerInfo {
  id: PlayerId;
  displayName: string;
}

export interface ServerEngineOptions {
  simFPS: number;
  globalSimulationRateMultiplier: number;
}

/**
 * The main class for game servers.
 * Binds together all the server-side parts of the engine.
 */
export class ServerEngine implements Engine {
  public static defaultOptions: ServerEngineOptions = {
    simFPS: 30,
    // TODO network this value and make the client handle it changing between frames.
    globalSimulationRateMultiplier: 1.0,
  };
  public options: ServerEngineOptions;
  public onPlayerConnected: tsEvents.BaseEvent<PlayerId> = new tsEvents.QueuedEvent<PlayerId>();

  public constructor(
    private authenticatePlayer: AuthCallback,
    options: Partial<ServerEngineOptions>
  ) {
    this.options = Object.assign({}, ServerEngine.defaultOptions, options);
    this.networkServer.onConnection.attach(({ playerId, networkPeer }) => {
      console.log(`Player connected: playerId = ${playerId}`);
      this.playerInfos.set(playerId, {
        id: playerId,
        displayName: playerId.toString(),
      });
      this.frameUpdateSenders.set(
        playerId,
        new FrameUpdateSender(playerId, networkPeer)
      );
      this.onPlayerConnected.post(playerId);
    });
    this.networkServer.onDisconnect.attach((playerId) => {
      this.frameUpdateSenders.delete(playerId);
    });
    registerMessageTypes(
      this.networkServer.registerMessageType.bind(this.networkServer)
    );
    this.networkServer.registerMessageHandler(
      C2S_TimeSyncRequestMessage,
      (playerId, timeSyncRequest) => {
        let response = new S2C_TimeSyncResponseMessage();
        response.clientTimeS = timeSyncRequest.clientTimeS;
        response.serverTimeS = this.getSimulationTimeS();
        let outboundMessage = this.networkServer.sendMessage(
          playerId,
          response
        );
        if (outboundMessage !== undefined) {
          outboundMessage.currentPriority = Infinity;
          outboundMessage.ttl = 1;
        }
        this.networkServer.flushMessagesToNetwork(playerId);
      }
    );
    this.networkServer.registerMessageHandler(
      C2S_InputFrameMessage,
      (playerId, inputFramePacket) => {
        // Discard input packets too far in the future so that we cannot be spammed with data that persists for a long time
        let futureInputTimeWindowS = 4;
        if (
          inputFramePacket.targetSimulationTimeS >
          this.currentFrame.simulationTimeS + futureInputTimeWindowS
        ) {
          console.warn(
            `Discarding inputFramePacket greater than ${futureInputTimeWindowS} seconds ahead of simulation.`
          );
          return;
        }
        this.inputHandler.onInputFramePacket(playerId, inputFramePacket);
      }
    );
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
    // When the registered components have changed the EntityComponent state database must be rebuilt.
    this.currentFrame = this.simulationEngine.cloneSimulationFrame(
      this.currentFrame
    );
  }

  public addSystem(system: System): void {
    this.simulationEngine.addSystem(system);
  }

  public removeSystem(system: System): void {
    this.simulationEngine.removeSystem(system);
  }

  public getGameSimPeriodS(): number {
    return 1 / this.options.simFPS;
  }

  /**
   * A continuous time that represents how far along the simulation should be.
   * Not quantised to the frame timestamps, see frame time for that value.
   */
  public getSimulationTimeS(): number {
    return (
      (this.options.globalSimulationRateMultiplier * present()) / 1000 +
      this.presentTimeToSimulationTimeDeltaS
    );
  }

  public start(): void {
    this.presentTimeToSimulationTimeDeltaS = -this.getSimulationTimeS();
    this.currentFrame.simulationTimeS = this.getSimulationTimeS();
    this.updateLoop();
  }

  public listen(options: ListenOptions): Promise<AddressInfo> {
    return this.networkServer.listen(options);
  }

  private classRegistry = new ClassRegistry<Serializable>();
  private playerInfos = new Map<PlayerId, PlayerInfo>();
  private frameUpdateSenders = new Map<PlayerId, FrameUpdateSender>();
  private networkServer = new NetworkServer(
    this.classRegistry,
    this.authenticatePlayer
  );
  private simulationEngine: SimulationEngine = new SimulationEngine(
    this.classRegistry
  );
  private presentTimeToSimulationTimeDeltaS = 0;
  private inputHandler = new ServerInputHandler(this.simulationEngine);

  public currentFrame: SimulationFrameData = this.simulationEngine.createSimulationFrame();

  private updateLoop() {
    let curSimTimeS = this.getSimulationTimeS();
    let timeAmountInNeedOfSimulationS =
      curSimTimeS - this.currentFrame.simulationTimeS;

    // In order to prevent a catastrophic feedback loop due to our server being
    // unable to keep up with real time, and thus trying to do more work each frame,
    // we apply a limit on the number of frames we will simulate in an update.
    // We do this when our simulation gets more than 4 frames behind.
    // 4 frames allows us some small delays either in computing the simulation, or from other sources
    // (eg. garbage collection, other games running in same process...)
    // before we start adjusting our rate of simulation vs real time.
    // When we do this our presentTimeToSimulationTimeDeltaS must change
    // otherwise we will still "owe" the remaining simulation time on the next
    // update loop.
    let numFramesThreshold = 4;
    if (
      timeAmountInNeedOfSimulationS >
      numFramesThreshold * this.getGameSimPeriodS()
    ) {
      console.warn(
        'Decreasing simulation rate to compensate for delayed processing.'
      );
      // Keep 1 frame's worth of elapsed time and discard the rest.
      let timeToDiscardS =
        timeAmountInNeedOfSimulationS - this.getGameSimPeriodS();
      this.presentTimeToSimulationTimeDeltaS -= timeToDiscardS;
      timeAmountInNeedOfSimulationS = this.getGameSimPeriodS();
    }

    while (timeAmountInNeedOfSimulationS >= this.getGameSimPeriodS()) {
      let previousFrame = this.currentFrame;
      this.currentFrame = this.simulationEngine.createSimulationFrame();
      let newSimTimeS =
        previousFrame.simulationTimeS + this.getGameSimPeriodS();
      this.currentFrame.inputs = this.inputHandler.getInputFramesForSimTime(
        newSimTimeS
      );
      this.simulationEngine.stepSimulation(
        this.getGameSimPeriodS(),
        previousFrame,
        this.currentFrame
      );
      // At the moment this event flush is mainly just here so that onPlayerConnected event
      // triggers.
      // Some more thought may be needed to how events could / should interact with the game state however.
      // eg. if systems get to raise events, should they flush at the end of the frame or start etc.?
      tsEvents.flush();

      // By copying the data to itself, we quantize the state, which ensures that the values being
      // passed in to the next step will match more closely those that the client will receive
      // on the network, as well as the client performing the same operation on itself to create
      // the same effect.
      // This makes determinism a bit better, not that we're aiming for full determinism support
      // TODO quantize input too? Before the step?
      this.simulationEngine.copySimulationState(
        this.currentFrame.state,
        this.currentFrame.state
      );
      timeAmountInNeedOfSimulationS -= this.getGameSimPeriodS();
    }

    // Process networking as there's fresh frame state to send to players.
    // We could potentially tick networking at other times too to utilise bandwidth between
    // simulation updates.
    // Serialize all components once to save on doing so for each player
    let aliveComponentsAndSerializedData = new Array<ComponentAndSerializedData>();
    let measureStream = new MeasureStream();
    let blankArray = new Uint8Array();
    for (let c of this.currentFrame.state
      .getEntityComponentDb()
      .getAllComponents()) {
      if (!c.isDeleted) {
        aliveComponentsAndSerializedData.push({
          component: c,
          serializedData: blankArray,
        });
        c.data.serialize(measureStream);
      }
    }
    let componentDataBuffer = new ArrayBuffer(
      measureStream.getNumBytesWritten()
    );
    let writeStream = new WriteStream(new DataView(componentDataBuffer));
    for (let c of aliveComponentsAndSerializedData) {
      let startOffset = writeStream.getNumBytesWritten();
      c.component.data.serialize(writeStream);
      let endOffset = writeStream.getNumBytesWritten();
      c.serializedData = new Uint8Array(
        componentDataBuffer,
        startOffset,
        endOffset - startOffset
      );
    }
    this.frameUpdateSenders.forEach((sender) => {
      sender.sendFrameUpdate(
        this.currentFrame,
        aliveComponentsAndSerializedData
      );
    });

    // releaseDeletedState needs to happen after anything that cares about seeing deletion markers
    this.currentFrame.state.releaseDeletedState();
    this.networkServer.flushMessagesToNetwork();
    // Schedule the next update to coincide with the start time of the next unsimulated frame.
    let nextFrameStartTimeS =
      this.currentFrame.simulationTimeS + this.getGameSimPeriodS();
    let nextFrameStartOffsetMS =
      (nextFrameStartTimeS - this.getSimulationTimeS()) * 1000;
    setTimeout(() => this.updateLoop(), nextFrameStartOffsetMS);
  }
}
