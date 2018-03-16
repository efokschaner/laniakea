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

class ServerTimeEstimator {
  public update() {

  }
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
  private updateSimulationHandle: PeriodicCallbackHandle;

  private updateSimulation() {
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
  }

  start() {
    this.currentFrameStartWallTimeMS = present();
    this.updateSimulationHandle = periodicCallback(this.updateSimulation.bind(this), this.gameSimPeriodMS, 'updateSimulation');

    requestAnimationFrame(this.renderLoop.bind(this));
  }

  stop() {
    this.updateSimulationHandle.stop();

  }

  renderLoop(wallTimeNowMS: number) {
    requestAnimationFrame(this.renderLoop.bind(this));
    if (this.renderingSystem) {
      this.renderingSystem.render(wallTimeNowMS, this.engine);
    }
  }
}