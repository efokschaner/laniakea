// tslint:disable-next-line:no-var-requires
const present = require('present');

import {
  C2S_TimeSyncRequestPacket,
  S2C_TimeSyncResponsePacket,
} from 'laniakea-shared';

import { NetworkClient } from './network-client';

interface TimeSyncSample {
  calculatedDeltaS: number;
  calculatedRttS: number;
}

/**
 * Calculates the most precise possible estimate of current simulation time on the server
 * Any smoothing, such as that needed to avoid time going backwards etc. should be applied at a higher level.
 */
export class ServerTimeEstimator {
  constructor(private networkClient: NetworkClient, private globalSimulationRateMultiplier: number) {
    networkClient.registerPacketHandler(S2C_TimeSyncResponsePacket, (response) => this.onTimeSyncResponse(response));
  }

  /**
   * Should be called periodically to allow new time sync requests
   */
  public update() {
    if (!this.networkClient.isConnected) {
      return;
    }
    let curTimeS = this.getPresentTimeS();
    if (this.nextRequestTime === undefined || curTimeS >= this.nextRequestTime) {
      let req = new C2S_TimeSyncRequestPacket();
      req.clientTimeS = curTimeS;
      this.networkClient.sendPacket(req);
      this.nextRequestTime = this.getNextRequestTimeJitteredS(curTimeS);
    }
  }

  /**
   * Returns undefined until we have at least a single sample.
   *
   * TODO: Given that the server simulation will slow down if overloaded, this class
   * should potentially also calculate and use an estimate of the current ratio
   * between server simulation and client time. This may also matter if the client
   * and server's clock speeds are just different.
   */
  public getServerSimulationTimeS(): number|undefined {
    if (this.estimatedTimeDeltaS === undefined) {
      return undefined;
    }
    return this.estimatedTimeDeltaS + this.getPresentTimeS();
  }

  /**
   * Returns undefined until we have at least a single sample.
   */
  public getPacketRoundTripTimeS(): number|undefined {
    return this.estimatedRttS;
  }

  private getPresentTimeS() {
    return this.globalSimulationRateMultiplier * present() / 1000;
  }

  private onTimeSyncResponse(response: S2C_TimeSyncResponsePacket) {
    // We use formulae similar to https://en.wikipedia.org/wiki/Network_Time_Protocol#Clock_synchronization_algorithm
    // However we assume t2 and t1 are the same because up here in JavaScript land, and un-supported by webrtc:
    // We do not get separate network receive and respond timestamps, only one to signify the packet is handled in JS.
    // This is perhaps better anyway as we care about "application" layer latency too.
    let responseReceivedTimeS = this.getPresentTimeS();
    this.timeSyncSamples[this.nextCyclicSampleIndex] = {
      calculatedDeltaS: response.serverTimeS - (response.clientTimeS + responseReceivedTimeS) / 2,
      calculatedRttS: responseReceivedTimeS - response.clientTimeS,
    };
    this.nextCyclicSampleIndex = (this.nextCyclicSampleIndex + 1) % this.cyclicSampleMaxLength;
    this.updateEstimatedTimes();
  }

  private updateEstimatedTimes() {
    // On first update we just accept the one entry
    if (this.timeSyncSamples.length === 1) {
      this.estimatedTimeDeltaS = this.timeSyncSamples[0].calculatedDeltaS;
      this.estimatedRttS = this.timeSyncSamples[0].calculatedRttS;
      return;
    }
    let rtts = this.timeSyncSamples.map((x) => x.calculatedRttS);
    let sum = (a: number, b: number) => a + b;
    let meanRtt = rtts.reduce(sum, 0) / this.timeSyncSamples.length;
    let varianceRtt = rtts.map((x) => Math.pow(x - meanRtt, 2)).reduce(sum, 0) / (rtts.length - 1);
    let stdDevRtt = Math.sqrt(varianceRtt);
    let samplesThatAreNotOutliers = this.timeSyncSamples.filter((value) => Math.abs(value.calculatedRttS - meanRtt) <= stdDevRtt);
    let meanRttOfNonOutliers = samplesThatAreNotOutliers
      .map((x) => x.calculatedRttS)
      .reduce(sum, 0) / samplesThatAreNotOutliers.length;
    let meanTimeDeltaOfNonOutliers = samplesThatAreNotOutliers
      .map((x) => x.calculatedDeltaS)
      .reduce(sum, 0) / samplesThatAreNotOutliers.length;
    this.estimatedRttS = meanRttOfNonOutliers;
    this.estimatedTimeDeltaS = meanTimeDeltaOfNonOutliers;
  }

  private nextCyclicSampleIndex = 0;
  private readonly cyclicSampleMaxLength = 10;
  private timeSyncSamples = new Array<TimeSyncSample>();

  private readonly requestPeriodS = 2;
  private getNextRequestTimeJitteredS(_lastRequestTimeS: number): number {
    return (Math.random() + 0.5) * this.requestPeriodS;
  }
  // undefined if no request has been sent yet
  private nextRequestTime?: number;

  // Represents server's simulation time - client's present time
  // Undefined until we have a single sample.
  private estimatedTimeDeltaS?: number;

  // Undefined until we have a single sample;
  private estimatedRttS?: number;
}
