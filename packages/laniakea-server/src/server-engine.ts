const present = require('present');
import {
  C2S_InputFramePacket,
  C2S_TimeSyncRequestPacket,
  createDownButtonsFromInputFrame,
  Engine,
  InputFrame,
  NumericEnum,
  PlayerId,
  S2C_FrameUpdatePacket,
  S2C_TimeSyncResponsePacket,
  SimluationFrameData,
  StepParams,
  createEngine,
  measureAndSerialize,
  registerPacketTypes
} from 'laniakea-shared';
import * as tsEvents from 'ts-events';
import { NetworkServer } from './network-server';
import { ServerInputHandler } from './server-input-handler';


export interface PlayerInfo {
  id: PlayerId;
  displayName: string;
}

export interface ServerEngineOptions {
  simFPS: number
}

export class ServerEngine {
  private playerInfos = new Map<PlayerId, PlayerInfo>();

  static defaultOptions: ServerEngineOptions = {
    simFPS: 30
  };
  options: ServerEngineOptions;
  onPlayerConnected: tsEvents.BaseEvent<PlayerId> = new tsEvents.QueuedEvent<PlayerId>();

  constructor(private networkServer: NetworkServer, options: Partial<ServerEngineOptions>) {
    this.options = Object.assign({}, ServerEngine.defaultOptions, options);
    networkServer.onConnection.attach(playerId => {
      console.log(`Player connected: playerId = ${playerId}`);
      this.playerInfos.set(playerId, {
        id: playerId,
        displayName: playerId.toString()
      });
      this.onPlayerConnected.post(playerId);
    });
    registerPacketTypes(networkServer.registerPacketType.bind(networkServer));
    networkServer.registerPacketHandler(C2S_TimeSyncRequestPacket, (playerId, timeSyncRequest) => {
      let response = new S2C_TimeSyncResponsePacket();
      response.clientTimeS = timeSyncRequest.clientTimeS;
      response.serverTimeS = this.getSimulationTimeS();
      networkServer.sendPacket(playerId, response);
    });
    networkServer.registerPacketHandler(C2S_InputFramePacket, (playerId, inputFramePacket, packetSequenceNumber) => {
      // Discard input packets too far in the future so that we cannot be spammed with data that persists for a long time
      let futureInputTimeWindowS = 4;
      if(inputFramePacket.targetSimulationTimeS > this.currentFrame.simulationTimeS + futureInputTimeWindowS) {
        console.warn(`Discarding inputFramePacket greater than ${futureInputTimeWindowS} seconds ahead of simulation.`);
        return;
      }
      this.inputHandler.onInputFramePacket(playerId, inputFramePacket, packetSequenceNumber);
    });
  }

  registerInputButtons(buttonsEnum: any): void {
    this.engine.registerButtons(buttonsEnum);
    this.inputHandler.registerButtons(buttonsEnum);
  }

  // TODO, encapsulate engine
  engine = createEngine();
  public currentFrame: SimluationFrameData = this.engine.createSimulationFrame();

  getGameSimPeriodS() { return 1 / this.options.simFPS; }

  private presentTimeToSimulationTimeDeltaS = 0;

  private inputHandler = new ServerInputHandler();

  /**
   * A continuous time that represents how far along the simulation should be.
   * Not quantised to the frame timestamps, see frame time for that value.
   */
  getSimulationTimeS() {
    return (present() / 1000) + this.presentTimeToSimulationTimeDeltaS;
  }

  start() {
    this.presentTimeToSimulationTimeDeltaS = - (present() / 1000);
    this.currentFrame.simulationTimeS = this.getSimulationTimeS();
    this.updateLoop();
  }

  updateLoop() {
    let curSimTimeS = this.getSimulationTimeS();
    let timeAmountInNeedOfSimulationS = curSimTimeS - this.currentFrame.simulationTimeS;

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
    if(timeAmountInNeedOfSimulationS > numFramesThreshold * this.getGameSimPeriodS()) {
      console.warn('Decreasing simulation rate to compensate for delayed processing.');
      // Keep 1 frame's worth of elapsed time and discard the rest.
      let timeToDiscardS = timeAmountInNeedOfSimulationS - this.getGameSimPeriodS();
      this.presentTimeToSimulationTimeDeltaS -= timeToDiscardS;
      timeAmountInNeedOfSimulationS = this.getGameSimPeriodS();
    }

    while(timeAmountInNeedOfSimulationS >= this.getGameSimPeriodS()) {
      let previousFrame = this.currentFrame;
      this.currentFrame = this.engine.createSimulationFrame();
      let newSimTimeS = previousFrame.simulationTimeS + this.getGameSimPeriodS();
      this.currentFrame.inputs = this.inputHandler.getInputFramesForSimTime(newSimTimeS);
      this.engine.stepSimulation(this.getGameSimPeriodS(), previousFrame, this.currentFrame);
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
      this.engine.copySimulationState(this.currentFrame.state, this.currentFrame.state);
      timeAmountInNeedOfSimulationS -= this.getGameSimPeriodS();
    }

    // Tick networking as there's fresh frame state to send to players.
    // We could potentially tick networking at other times too to utilise bandwidth between
    // simulation updates.
    let componentDataBuffer = new Uint8Array(measureAndSerialize(this.currentFrame.state));
    this.playerInfos.forEach(pi => {
      let framePacket = new S2C_FrameUpdatePacket();
      framePacket.simulationFrameIndex = this.currentFrame.simulationFrameIndex;
      framePacket.simulationTimeS = this.currentFrame.simulationTimeS;
      framePacket.componentData = componentDataBuffer;
      let maybeInputs = this.currentFrame.inputs.get(pi.id);
      if(maybeInputs !== undefined) {
        framePacket.downButtons = createDownButtonsFromInputFrame(maybeInputs);
      }
      this.networkServer.sendPacket(pi.id, framePacket, () => {
        //console.log('ACK for:', framePacket.simulationTimeS);
      });
    });

    // Schedule the next update to coincide with the start time of the next unsimulated frame.
    let nextFrameStartTimeS = this.currentFrame.simulationTimeS + this.getGameSimPeriodS();
    let nextFrameStartOffsetMS = (nextFrameStartTimeS - this.getSimulationTimeS()) * 1000;
    setTimeout(() => this.updateLoop(), nextFrameStartOffsetMS);
  }
}
