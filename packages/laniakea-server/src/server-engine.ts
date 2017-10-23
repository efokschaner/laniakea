const present = require('present');
import * as THREE from 'three';
import * as tsEvents from 'ts-events';

import {
  createEngine,
  Engine,
  measureAndSerialize,
  S2C_FrameUpdatePacket,
} from 'laniakea-shared';

import { NetworkServer, PlayerId } from './network-server';

export interface PlayerInfo {
  id: PlayerId;
  displayName: string;
}

export type Partial<T> = {
  [P in keyof T]?: T[P];
};

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
    networkServer.onConnection.attach((playerId) => {
      console.log(`Player connected: playerId = ${playerId}`);
      this.playerInfos.set(playerId, {
        id: playerId,
        displayName: playerId.toString()
      });
      this.onPlayerConnected.post(playerId);
    });
  }

  private lastFrameStartTimeS = 0;
  private lastFrameIndex = 0;
  private timeAmountInNeedOfSimulationS = 0;
  engine = createEngine();

  getGameSimPeriodS() { return 1 / this.options.simFPS; }

  start() {
    this.lastFrameStartTimeS = present() / 1000;
    this.updateLoop();
  }

  updateLoop() {
    let frameStartTimeS = present() / 1000;
    let timeDeltaS = frameStartTimeS - this.lastFrameStartTimeS;
    this.lastFrameStartTimeS = frameStartTimeS;
    timeDeltaS = Math.min(timeDeltaS, 0.25);
    this.timeAmountInNeedOfSimulationS += timeDeltaS;
    while(this.timeAmountInNeedOfSimulationS >= this.getGameSimPeriodS()) {
      tsEvents.flush();
      this.engine.stepSimulation(this.getGameSimPeriodS());
      this.timeAmountInNeedOfSimulationS -= this.getGameSimPeriodS();
    }
    let componentDataBuffer = new Uint8Array(measureAndSerialize(this.engine));
    let framePacket = new S2C_FrameUpdatePacket();
    framePacket.simulationTimeS = this.engine.currentSimulationTimeS,
    framePacket.componentData = componentDataBuffer;

    let messageBuffer = new Uint8Array(measureAndSerialize(framePacket));
    this.playerInfos.forEach(pi => {
      this.networkServer.sendPacket(pi.id, messageBuffer, () => {
        //console.log('ACK for:', framePacket.simulationTimeS);
      });
    });

    let nextFrameStartTimeS = frameStartTimeS + this.getGameSimPeriodS();
    let nextFrameStartOffsetMS = (nextFrameStartTimeS * 1000) - present();
    setTimeout(() => this.updateLoop(), nextFrameStartOffsetMS);
  }
}
