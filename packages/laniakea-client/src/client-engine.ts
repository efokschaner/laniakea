const present = require('present');

import {
  createEngine,
  ComponentEngine,
  Engine,
  ReadStream,
  S2C_FrameUpdatePacket
} from 'laniakea-shared';

import { NetworkClient } from './network-client';

export interface RenderingSystem {
  render(wallTimeNowMS: number, engine: ComponentEngine): void;
}

class ServerTimeEstimator {
  public update() {

  }

}

class Loop {
  constructor(private cb: () => void, private periodMS: number) {
  }

  start() {
    this.shouldRun = true;
    setTimeout(() => {
      if (this.shouldRun) {
        let startTime = present();
        this.cb();
      }
    }, 0);
  }

  stop() {

  }

  private shouldRun = false;


}

export class ClientEngine {
  public readonly engine = createEngine();
  public readonly networkClient = new NetworkClient();
  private renderingSystem?: RenderingSystem;

  public setRenderingSystem(s: RenderingSystem) {
    this.renderingSystem = s;
  }

  constructor(public simFPS: number) {
    let logcounter = 0;
    this.networkClient.onPacketReceived.attach(msg => {
      let dataView = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
      let readStream = new ReadStream(dataView);
      let framePacket = new S2C_FrameUpdatePacket();
      framePacket.serialize(readStream);
      let componentDataDataView = new DataView(framePacket.componentData.buffer, framePacket.componentData.byteOffset, framePacket.componentData.byteLength);
      this.engine.serialize(new ReadStream(componentDataDataView));
      if(++logcounter % 100 == 0) {
        console.log('message length:', msg.byteLength);
      }
    });
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
    if (this.renderingSystem) {
      this.renderingSystem.render(wallTimeNowMS, this.engine);
    }
  }
}