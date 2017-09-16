import * as msgpack from 'msgpack-lite';
const present = require('present');
import * as THREE from 'three';

import {
  createEngine,
  Engine,
  measureAndSerialize
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
  }
  options: ServerEngineOptions;
  constructor(private networkServer: NetworkServer, options: Partial<ServerEngineOptions>) {
    this.options = Object.assign({}, ServerEngine.defaultOptions, options);
    networkServer.onConnection.attach((playerId) => {
      console.log(`Player connected: playerId = ${playerId}`);
      this.playerInfos.set(playerId, {
        id: playerId,
        displayName: playerId.toString()
      });
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
      this.engine.stepSimulation(this.getGameSimPeriodS());
      this.timeAmountInNeedOfSimulationS -= this.getGameSimPeriodS();
    }
    let componentDataBuffer = measureAndSerialize(this.engine);
    let message = {
      simulationTime: this.engine.currentSimulationTimeS,
      componentData: componentDataBuffer
    };

    let messageBuffer = msgpack.encode(message);
    this.playerInfos.forEach(pi => {
      // copy because msgpack pools buffers and can overwrite before webrtc has sent.
      this.networkServer.sendPacket(pi.id, Uint8Array.from(messageBuffer), () => {
        //console.log('ACK for:', message.serverTime);
      });
    });

    let nextFrameStartTimeS = frameStartTimeS + this.getGameSimPeriodS();
    let nextFrameStartOffsetMS = (nextFrameStartTimeS * 1000) - present();
    setTimeout(() => this.updateLoop(), nextFrameStartOffsetMS);
  }
}
