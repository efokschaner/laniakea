const present = require('present');

import {
  createEngine,
  Engine
} from 'laniakea-shared';

import { NetworkClient } from './network-client';

export interface RenderingSystem {
  render(wallTimeNowMS: number, engine: Engine): void;
}

export class ClientEngine {
  public readonly engine = createEngine();
  public readonly networkClient = new NetworkClient();
  constructor(private renderingSystem: RenderingSystem, public simFPS: number) {
  }
  gameSimPeriodS = 1 / this.simFPS;
  gameSimPeriodMS = 1000 * this.gameSimPeriodS;
  public currentFrameStartWallTimeMS = 0;
  private timeAmountInNeedOfSimulationMS = 0;
  private simLoop() {
    let newCurrentFrameStartWallTimeMS = present();
    let wallTimeDeltaMS = newCurrentFrameStartWallTimeMS - this.currentFrameStartWallTimeMS;
    this.currentFrameStartWallTimeMS = newCurrentFrameStartWallTimeMS;
    this.timeAmountInNeedOfSimulationMS += wallTimeDeltaMS;
    while(this.timeAmountInNeedOfSimulationMS >= this.gameSimPeriodMS) {
      this.engine.stepSimulation(this.gameSimPeriodS);
      this.timeAmountInNeedOfSimulationMS -= this.gameSimPeriodMS;
    }

    // NETWORKING
    this.networkClient.sendPacket(
      Uint8Array.from([]),
      //() => console.log('acked')
    );

    let currentFrameEndWallTimeMS = present();
    let frameDurationMS = currentFrameEndWallTimeMS - this.currentFrameStartWallTimeMS;
    let timeToNextFrameMS = this.gameSimPeriodMS - frameDurationMS;
    if(timeToNextFrameMS < 0) {
      console.warn(`simLoop took longer than gameSimPeriodS. frameDurationMS=${frameDurationMS}`);
      timeToNextFrameMS = 0;
    }
    setTimeout(this.simLoop.bind(this), timeToNextFrameMS);
  }

  start() {
    this.currentFrameStartWallTimeMS = present();
    setTimeout(this.simLoop.bind(this), 0);
    requestAnimationFrame(this.renderLoop.bind(this));
  }

  renderLoop(wallTimeNowMS: number) {
    requestAnimationFrame(this.renderLoop.bind(this));
    this.renderingSystem.render(wallTimeNowMS, this.engine);
  }
}