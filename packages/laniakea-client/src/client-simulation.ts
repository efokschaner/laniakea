import {
  CyclicBuffer,
  Engine,
  InputFrame,
  PlayerId,
  ReadStream,
  SimluationFrameData,
  S2C_FrameDeletionsMessage,
  EntityId,
  GenericComponent,
  S2C_FrameInputsUsedMessage,
  S2C_FrameComponentStateMessage,
} from 'laniakea-shared';
import { ServerTimeEstimator } from './server-time-estimator';

interface ComponentAndSerializedData {
  component: GenericComponent;
  serializedData: Uint8Array;
}

export class ClientSimluationFrameData {
  constructor(
    public resolvedFrameData: SimluationFrameData,
  ) {
  }

  /**
   * Inputs that we predict that the server will process this frame.
   */
  public predictedInput?: InputFrame;

  /**
   * The timestamp of this frame that the server has confirmed it used.
   */
  public receivedAuthoritativeSimulationTimeS?: number;

  /**
   * The input that the server has confirmed it used for us this frame.
   */
  public receivedAuthoritativeInput?: InputFrame;

  /**
   * Authoritative data regarding component state that we have been told about
   */
  public receivedAuthoritativeComponentData = new Array<ComponentAndSerializedData>();

  /**
   * Authoritative data regarding deleted entities
   */
  public receivedEntityDeletions = new Array<EntityId>();

  /**
   * Authoritative data regarding deleted components
   */
  public receivedComponentDeletions = new Array<number>();
}

/**
 * This holds multiple frames of the simulation at one time along with the necessary information
 * to rewind and replay the simulation so that we can feed "old" state packets in to the simulation,
 * and re-simulate the new state based on that revision of history.
 * A packet can be "old" either because it was sincerely delayed OR because we're intentionally
 * trying to render a simulation time that is greater than servertime - one-way-latency (i.e we're doing
 * client side prediction to get ahead of what the server has had time to confirm and send).
 * Either way this simulation approach allows us to take server data that was for a few moments ago
 * and reasonably validly work it in to our simulation..
 *
 * TODO Investigate using a WebWorker so that simulation can run in parallel to the render thread.
 * Note that WebRTC is not available to WebWorkers currently so the render thread would still need to marshall
 * updates from the network to the webworker.
 *
 * Another TODO, if the client cannot keep up with the server its simulation will fall behind until
 * it explodes, need to figure out how we can detect it / relieve pressure etc.
 * I'm not sure how to deal with it yet so we'll just let it explode for now.
 * It may well require a negotiated state flush of some sort from the game server similar to reconnect.
 */
export class ClientSimulation {
  constructor(
    secondsOfHistoryToRetain: number,
    private simFPS: number,
    private serverTimeEstimator: ServerTimeEstimator,
    private engine: Engine) {
    let numberOfFramesToRetain = Math.round(secondsOfHistoryToRetain * simFPS);
    this.frames = new CyclicBuffer<ClientSimluationFrameData>(numberOfFramesToRetain);
  }

  private playerId?: PlayerId = undefined;
  public onPlayerIdAssigned(playerId: PlayerId): void {
    this.playerId = playerId;
  }

  /**
   * Get the playerId for this client. undefined until connection is established to server.
   */
  public getOwnPlayerId(): PlayerId|undefined {
    return this.playerId;
  }

  /**
   * This is the estimate of the current simulation time on the server.
   * undefined is returned when we are not synchronised with the server.
   */
  public getCurrentSimulationTimeS(): number | undefined {
    return this.serverTimeEstimator.getServerSimulationTimeS();
  }

  /**
   * This is the 1 way latency to the server
   * undefined is returned when we are not synchronised with the server.
   */
  public getInputTravelTimeS(): number | undefined {
    let rtt = this.serverTimeEstimator.getPacketRoundTripTimeS();
    if (rtt === undefined) {
      return undefined;
    }
    return rtt / 2;
  }

  /**
   * Gets 2 simulation frames.
   * "current" being the nearest frame preceeding the given sim time.
   * "next" being the next frame after current.
   * Returns undefined if we do not yet have enough data from the server to simulate any frames.
   */
  public getSimulationFrames(simulationTimeS: number): { current: SimluationFrameData, next: SimluationFrameData } | undefined {
    this.doSimulationWork(simulationTimeS);
    let successorFrameIndex =  this.getSuccessorFrameForSimTime(simulationTimeS);
    if (successorFrameIndex === undefined) {
      return undefined;
    }
    let current = this.frames.getElement(successorFrameIndex - 1);
    let next = this.frames.getElement(successorFrameIndex);
    if (next === undefined || current === undefined) {
      return undefined;
    }
    return {current: current.resolvedFrameData, next: next.resolvedFrameData};
  }

  /**
   * Does a binary search of the frames in order to find the smallest frame index
   * with a simulation time greater than the given param. Note this can return
   * dirty / unsimulated frames.
   * Returns undefined if there is no simulation frame less than the given simTime
   */
  private getSuccessorFrameForSimTime(simulationTimeS: number): number|undefined {
    let lowerBound = this.getOldestInitializedFrameIndex();
    if (lowerBound === undefined) {
      return undefined;
    }
    if (this.largestInitializedFrameIndex === undefined) {
      return undefined;
    }
    let initialUpperBound = this.largestInitializedFrameIndex;
    let upperBound = initialUpperBound;
    while (lowerBound <= upperBound) {
      // tslint:disable-next-line:no-bitwise
      let middleIndex: number = lowerBound + (upperBound - lowerBound >> 1);
      let midValue = this.frames.getElement(middleIndex)!.resolvedFrameData.simulationTimeS;
      if (midValue > simulationTimeS) {
        upperBound = middleIndex - 1;
      } else {
        lowerBound = middleIndex + 1;
      }
    }
    // Handle the possibility that none of the frame times were greater:
    if (upperBound === initialUpperBound) {
      return undefined;
    }
    return upperBound + 1;
  }

  private markFrameAsDirty(frameIndex: number) {
    // Now make sure the frame is marked as dirty
    this.oldestDirtySimulationFrameIndex = Math.min(this.oldestDirtySimulationFrameIndex!, frameIndex);
    // If this is the first frame we have received we immediately apply the authoritative state so that the
    // frame is considered useable to simulate the next frame.
    if (this.firstEverFrameIndex === frameIndex) {
      let targetFrame = this.frames.getElement(frameIndex)!;
      this.applyPredictedOrAuthoritativeInputsToResolvedInputs(targetFrame);
      this.applyAuthoritativeStateToResolvedState(targetFrame);
      // Mark the NEXT frame as dirty as this frame is completely "up to date" now.
      this.oldestDirtySimulationFrameIndex = frameIndex + 1;
    }
  }

  /**
   * This is not meant to be called by users of library. TODO create external interface for this class.
   */
  public onFrameInputsUsedMessage(frameMessage: S2C_FrameInputsUsedMessage) {
    let targetFrame = this.getOrInsertFrameWithoutSimulation(frameMessage.simulationFrameIndex);
    if (targetFrame === undefined) {
      console.warn('Discarding update for frame that was too old. ' +
        `simulationFrameIndex: ${frameMessage.simulationFrameIndex} simulationTimeS: ${frameMessage.simulationTimeS}`);
      return;
    }
    targetFrame.receivedAuthoritativeSimulationTimeS = frameMessage.simulationTimeS;

    targetFrame.receivedAuthoritativeInput = this.engine.createInputFrame();
    if (frameMessage.inputUsedForPlayerThisFrame.byteLength > 0) {
      let inputFrameDataView = new DataView(
        frameMessage.inputUsedForPlayerThisFrame.buffer,
        frameMessage.inputUsedForPlayerThisFrame.byteOffset,
        frameMessage.inputUsedForPlayerThisFrame.byteLength);
      targetFrame.receivedAuthoritativeInput.serialize(new ReadStream(inputFrameDataView));
    }

    this.markFrameAsDirty(frameMessage.simulationFrameIndex);
  }

  /**
   * This is not meant to be called by users of library. TODO create external interface for this class.
   */
  public onFramecomponentStateMessage(frameComponentStateMessage: S2C_FrameComponentStateMessage) {
    let targetFrame = this.getOrInsertFrameWithoutSimulation(frameComponentStateMessage.simulationFrameIndex);
    if (targetFrame === undefined) {
      console.warn('Discarding update for frame that was too old. ' +
        `simulationFrameIndex: ${frameComponentStateMessage.simulationFrameIndex} simulationTimeS: ${frameComponentStateMessage.simulationTimeS}`);
      return;
    }
    targetFrame.receivedAuthoritativeSimulationTimeS = frameComponentStateMessage.simulationTimeS;

    let componentData = frameComponentStateMessage.componentData;
    let dataView = new DataView(componentData.buffer, componentData.byteOffset, componentData.byteLength);
    let readStream = new ReadStream(dataView);
    // TODO remove this brittle offset that assumes the data is 13 bytes past the start of the component
    let dataOffsetInComponent = 13;
    while (readStream.hasMoreData()) {
      let startOffset = readStream.getNumBytesRead();
      // TODO remove this brittle "peek" that assumes the first 32 bits of component are kindid
      let componentKindId = dataView.getUint32(startOffset);
      let component = this.engine.componentReflection.constructComponent(componentKindId, 0, 0);
      component.serialize(readStream);
      let endOffset = readStream.getNumBytesRead();
      let serializedData = new Uint8Array(componentData.buffer, componentData.byteOffset + startOffset + dataOffsetInComponent, endOffset - startOffset);
      targetFrame.receivedAuthoritativeComponentData.push({component, serializedData})
    }

    this.markFrameAsDirty(frameComponentStateMessage.simulationFrameIndex);
  }

  /**
   * This is not meant to be called by users of library. TODO create external interface for this class.
   */
  public onFrameDeletionsMessage(frameDeletionsMessage: S2C_FrameDeletionsMessage) {
    let targetFrameIndex = frameDeletionsMessage.simulationFrameIndex;
    let targetFrame = this.getOrInsertFrameWithoutSimulation(targetFrameIndex);
    if (targetFrame === undefined) {
      // We never want to ignore deletions, the best we can do is insert them in to the oldest frame we do have.
      targetFrameIndex = this.getOldestInitializedFrameIndex()!;
      targetFrame = this.frames.getElement(targetFrameIndex)!;
    } else {
      targetFrame.receivedAuthoritativeSimulationTimeS = frameDeletionsMessage.simulationTimeS;
    }

    targetFrame.receivedComponentDeletions = targetFrame.receivedComponentDeletions.concat(frameDeletionsMessage.deletedComponentIds);
    targetFrame.receivedEntityDeletions = targetFrame.receivedEntityDeletions.concat(frameDeletionsMessage.deletedEntityIds);

    this.markFrameAsDirty(targetFrameIndex);
  }

  /**
   * This is not meant to be called by users of library. TODO create external interface for this class.
   * @param inputFrame
   * @param targetSimulationTimeS
   */
  public notifyInputBeingSent(inputFrame: InputFrame, targetSimulationTimeS: number) {
    // Estimate the frame index of arrival
    if (this.oldestDirtySimulationFrameIndex === undefined) {
      return;
    }
    let oldestConfidentSimFrame = this.frames.getElement(this.oldestDirtySimulationFrameIndex - 1)!;
    let numFramesAhead = Math.ceil((targetSimulationTimeS - oldestConfidentSimFrame.resolvedFrameData.simulationTimeS) * this.simFPS);
    // Note numFramesAhead could be negative
    let targetFrameIndex = oldestConfidentSimFrame.resolvedFrameData.simulationFrameIndex + numFramesAhead;
    // We don't care about simulation we just need a data structure in which to store our predicted input
    let targetFrameData = this.getOrInsertFrameWithoutSimulation(targetFrameIndex);
    if (targetFrameData === undefined) {
      return;
    }
    // Copy the input frame so that any modifications to the passed data are not applied to our entry
    // By virtue of the fact that this uses serialisation, it also ensures the inputframe is "quantized"
    // before its used for client prediction, so that it matches what the server would get.
    if (targetFrameData.predictedInput === undefined) {
      targetFrameData.predictedInput = this.engine.createInputFrame();
    }
    this.engine.copyInputFrame(inputFrame, targetFrameData.predictedInput);
    // We've modified the frame so mark it as dirty.
    this.oldestDirtySimulationFrameIndex = Math.min(this.oldestDirtySimulationFrameIndex, targetFrameIndex);
  }

  /**
   * This is not meant to be called by users of library. TODO create external interface for this class.
   *
   * Performs any outstanding simulation work between the "dirty" checkpoint and the requested simulationTimeS
   * Simulation will be done for the next frame to occurr after simulationTimeS on the assumption that there
   * may be interpolation between the preceeding and subsequent frame.
   * Uninitialised frames will be added as we go.
   */
  public doSimulationWork(simulationTimeS: number) {
    if (this.oldestDirtySimulationFrameIndex === undefined) {
      // We have nothing to simulate yet
      return;
    }
    let frameIndexToSimulate = this.oldestDirtySimulationFrameIndex;

    // Our oldest stored frame can become dirty if we receive a state update for it but we cannot
    // resimualte the whole frame because we do not have a previous frame.
    // In this case we do not perform a full resimulation, we just apply the known authoritative updates.
    if (frameIndexToSimulate === this.getOldestInitializedFrameIndex()) {
      let frame = this.getOrInsertFrameWithoutSimulation(frameIndexToSimulate)!;
      this.applyPredictedOrAuthoritativeInputsToResolvedInputs(frame);
      this.applyAuthoritativeStateToResolvedState(frame);
      // Mark the NEXT frame as dirty as this frame is completely "up to date" now.
      ++frameIndexToSimulate;
      this.oldestDirtySimulationFrameIndex = frameIndexToSimulate;
    }

    while (true) {
      let previousFrame = this.getOrInsertFrameWithoutSimulation(frameIndexToSimulate - 1)!;
      if (previousFrame.resolvedFrameData.simulationTimeS > simulationTimeS) {
        // We're done
        break;
      }
      let nextFrame = this.getOrInsertFrameWithoutSimulation(frameIndexToSimulate)!;
      this.simulateOneFrame(previousFrame, nextFrame);
      ++frameIndexToSimulate;
      // The next frame we would have simulated is the new checkpoint for simulation.
      this.oldestDirtySimulationFrameIndex = frameIndexToSimulate;
    }
  }

  private simulateOneFrame(previousFrame: ClientSimluationFrameData, nextFrame: ClientSimluationFrameData) {
    // Approximate the server behaviour where one frame's inputs are applied to next
    // in the absence of any other changes.
    nextFrame.resolvedFrameData.inputs = previousFrame.resolvedFrameData.inputs;
    this.applyPredictedOrAuthoritativeInputsToResolvedInputs(nextFrame);
    this.engine.stepSimulation(1 / this.simFPS, previousFrame.resolvedFrameData, nextFrame.resolvedFrameData);
    this.applyAuthoritativeStateToResolvedState(nextFrame);
    // By copying the data to itself, we quantize the state, which ensures that the values being
    // passed in to the next step will match more closely those that the client will receive
    // on the network, as well as the client performing the same operation on itself to create
    // the same effect.
    // This makes determinism a bit better, not that we're aiming for full determinism support
    this.engine.copySimulationState(nextFrame.resolvedFrameData.state, nextFrame.resolvedFrameData.state);
  }

  private insertNewFrame(frameIndex: number): ClientSimluationFrameData {
    let newFrame = this.engine.createSimulationFrame();
    newFrame.simulationFrameIndex = frameIndex;
    let newClientFrame = new ClientSimluationFrameData(newFrame);
    // In situations where the renderer is not ticking the simulation, eg. because the tab is not focused
    // The simulation can get so far behind that we can end up expiring the last known good frame outside our
    // cyclic buffer in which case our simulation mechanism breaks.
    // In order to avoid that we check for that case here and advance the simulation one tick to avoid
    // expiring our only simulated frame.
    let frameIndexWeAreAboutToReplace = frameIndex - this.frames.entries.length;
    if (this.oldestDirtySimulationFrameIndex === frameIndexWeAreAboutToReplace + 1 ) {
      this.simulateOneFrame(
        this.frames.getElement(frameIndexWeAreAboutToReplace)!,
        this.frames.getElement(frameIndexWeAreAboutToReplace + 1)!,
      );
      this.oldestDirtySimulationFrameIndex += 1;
    }
    this.frames.setElement(frameIndex, newClientFrame);
    return newClientFrame;
  }

  /**
   * Gets the frame data for frameIndex, initializes any new frames up to that index,
   * does NOT perform any simulation on any new frames that are added
   * Returns undefined if frameIndex is so far in the past that it is no longer available.
   * @param frameIndex
   */
  private getOrInsertFrameWithoutSimulation(frameIndex: number): ClientSimluationFrameData | undefined  {
    if (this.largestInitializedFrameIndex !== undefined) {
      if (this.largestInitializedFrameIndex >= frameIndex) {
        // We either already have the frame or it has been discarded
        if (this.getOldestInitializedFrameIndex()! <= frameIndex) {
          return this.frames.getElement(frameIndex);
        } else {
          return undefined;
        }
      }
      // Create all frames between the highest and this one.
      for (let frameIndexToInit = this.largestInitializedFrameIndex + 1; frameIndexToInit < frameIndex; ++frameIndexToInit) {
        this.insertNewFrame(frameIndexToInit);
      }
    }
    let result = this.insertNewFrame(frameIndex);
    if (this.largestInitializedFrameIndex === undefined) {
      this.firstEverFrameIndex = frameIndex;
      this.oldestDirtySimulationFrameIndex = frameIndex;
    } else {
      // Note here that we have not updated this.largestInitializedFrameIndex.
      // So it still currently refers to the frame before the ones we just inserted.
      this.oldestDirtySimulationFrameIndex = Math.min(this.oldestDirtySimulationFrameIndex!, this.largestInitializedFrameIndex + 1);
    }
    this.largestInitializedFrameIndex = frameIndex;
    return result;
  }

  private applyPredictedOrAuthoritativeInputsToResolvedInputs(frame: ClientSimluationFrameData) {
    if (frame.receivedAuthoritativeSimulationTimeS !== undefined) {
      frame.resolvedFrameData.simulationTimeS = frame.receivedAuthoritativeSimulationTimeS;
    }
    if (this.playerId === undefined) {
      // We cannot apply our own inputs before we know our own playerId
      return;
    }
    if (frame.receivedAuthoritativeInput !== undefined) {
      frame.resolvedFrameData.inputs = new Map([[this.playerId, frame.receivedAuthoritativeInput]]);
    } else if (frame.predictedInput !== undefined) {
      frame.resolvedFrameData.inputs = new Map([[this.playerId, frame.predictedInput]]);
    }
  }

  private applyAuthoritativeStateToResolvedState(frame: ClientSimluationFrameData): void {
    let state = frame.resolvedFrameData.state;
    for (let c of frame.receivedAuthoritativeComponentData) {
      // TODO make this less dirty
      // Beacause component data is mutable, and because we're handing the simulation our own
      // authoritative copy of the state, we first re-deserialize from the pristine data buffer.
      let readStream = new ReadStream(new DataView(c.serializedData.buffer, c.serializedData.byteOffset, c.serializedData.byteLength));
      c.component.getData().serialize(readStream);
      state.upsertComponent(c.component);
    }
    for (let i = 0; i < frame.receivedComponentDeletions.length; i += 2) {
      let kindId = frame.receivedComponentDeletions[i];
      let componentId = frame.receivedComponentDeletions[i + 1];
      state.deleteComponentWithKindId(kindId, componentId);
    }
    for (let entityId of frame.receivedEntityDeletions) {
      state.deleteEntity(entityId);
    }
    state.purgeDeletedState();
  }

  private frames: CyclicBuffer<ClientSimluationFrameData>;

  /**
   * An integer that represents the oldest simulation frame for which we have received modifications
   * that have not yet been propagated.
   * Any time a historical frame is modified we drop this number to match it so that we
   * re-simulate from that frame back to the desired frame.
   */
  private oldestDirtySimulationFrameIndex?: number;

  /**
   * An integer that represents the largest frame we have initialised so far.
   */
  private largestInitializedFrameIndex?: number;

  private firstEverFrameIndex?: number;
  /**
   * The oldest frame that we still have data for.
   * This starts equal to largestInitializedFrameIndex,
   * and ramps up to however many frames we store behind largestInitializedFrameIndex
   */
  private getOldestInitializedFrameIndex(): number | undefined {
    if (this.largestInitializedFrameIndex === undefined || this.firstEverFrameIndex === undefined) {
      return undefined;
    }
    return this.largestInitializedFrameIndex - Math.min(
      this.largestInitializedFrameIndex - this.firstEverFrameIndex, this.frames.entries.length - 1);
  }
}
