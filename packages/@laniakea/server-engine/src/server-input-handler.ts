import { Heap } from 'typescript-collections';

import {
  C2S_InputFrameMessage,
  InputFrame,
  PlayerId,
  ReadStream,
  SequenceNumber,
  SimulationEngine,
} from '@laniakea/base-engine';

interface InputBufferHeapEntry {
  targetSimulationTimeS: number;
  inputs: InputFrame;
  messageSequenceNumber: SequenceNumber;
}

function collectionsCompare(a: number, b: number): number {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

function compareTargetSimulationTimeS(
  a: InputBufferHeapEntry,
  b: InputBufferHeapEntry
): number {
  return collectionsCompare(a.targetSimulationTimeS, b.targetSimulationTimeS);
}

class InputBuffer {
  public constructor(private engine: SimulationEngine) {
    // Initialise with an empty input at t-zero
    this.inputHeap.add({
      targetSimulationTimeS: 0,
      inputs: this.engine.createInputFrame(),
      messageSequenceNumber: new SequenceNumber(),
    });
  }

  public onInputFramePacket(packet: C2S_InputFrameMessage) {
    let newFrame = this.engine.createInputFrame();
    let inputFrameDataView = new DataView(
      packet.inputFrame.buffer,
      packet.inputFrame.byteOffset,
      packet.inputFrame.byteLength
    );
    newFrame.serialize(new ReadStream(inputFrameDataView));
    this.inputHeap.add({
      targetSimulationTimeS: packet.targetSimulationTimeS,
      inputs: newFrame,
      messageSequenceNumber: packet.sequenceNumber,
    });
  }

  public getInputFrameForSimTime(simulationTimeS: number): InputFrame {
    // Pull all the input frames with a targetSimulationTimeS smaller than or equal to simulationTimeS
    let framesToCoallesce: InputBufferHeapEntry[] = [];
    for (
      let nextInput = this.inputHeap.peek();
      nextInput !== undefined &&
      nextInput.targetSimulationTimeS <= simulationTimeS;
      nextInput = this.inputHeap.peek()
    ) {
      framesToCoallesce.push(nextInput);
      this.inputHeap.removeRoot();
    }
    // Coallescing inputs for now just means grabbing the one with the highest sequence number.
    let result = framesToCoallesce.reduce(
      (acc: InputBufferHeapEntry | undefined, frame) => {
        if (
          acc === undefined ||
          frame.messageSequenceNumber.isGreaterThan(acc.messageSequenceNumber)
        ) {
          return frame;
        }
        return acc;
      },
      undefined
    );

    if (result === undefined) {
      throw new Error(
        'There should have been at least one entry in framesToCoallesce.'
      );
    }
    // After calculating we "save" the result as the new smallest value in the heap
    // in order to preserve the inputs in to the next frame's calculation.
    this.inputHeap.add({
      targetSimulationTimeS: simulationTimeS,
      inputs: result.inputs,
      messageSequenceNumber: result.messageSequenceNumber,
    });
    return result.inputs;
  }

  // A Binary heap of input packets stored in ascending targetSimulationTimeS order
  private inputHeap = new Heap<InputBufferHeapEntry>(
    compareTargetSimulationTimeS
  );
}

/**
 * Receives input packets and processes them so that they can be consumed per simulation frame.
 */
export class ServerInputHandler {
  public constructor(private engine: SimulationEngine) {}

  public onInputFramePacket(
    playerId: PlayerId,
    packet: C2S_InputFrameMessage
  ): void {
    let inputBuffer = this.getOrAddPlayerInputBuffer(playerId);
    inputBuffer.onInputFramePacket(packet);
  }

  public getInputFramesForSimTime(
    simulationTimeS: number
  ): Map<PlayerId, InputFrame> {
    let result = new Map<PlayerId, InputFrame>();
    for (let [playerId, inputBuffer] of this.perPlayerInputBuffers.entries()) {
      result.set(
        playerId,
        inputBuffer.getInputFrameForSimTime(simulationTimeS)
      );
    }
    return result;
  }

  private getOrAddPlayerInputBuffer(playerId: PlayerId): InputBuffer {
    let maybePlayerInputBuffer = this.perPlayerInputBuffers.get(playerId);
    if (maybePlayerInputBuffer !== undefined) {
      return maybePlayerInputBuffer;
    }
    maybePlayerInputBuffer = new InputBuffer(this.engine);
    this.perPlayerInputBuffers.set(playerId, maybePlayerInputBuffer);
    return maybePlayerInputBuffer;
  }

  private perPlayerInputBuffers = new Map<PlayerId, InputBuffer>();
}
