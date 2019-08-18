// tslint:disable-next-line:no-var-requires
const present = require('present');

import { SyncEvent } from 'ts-events';
import { ClassRegistry } from '../class-registry';
import { CyclicBuffer } from '../cyclic-buffer';
import { measureSerializable, ReadStream, Serializable, SerializationStream, WriteStream } from '../serialization';
import { AckingPeer } from './acking-peer';
import { AbsoluteSequenceNumberTranslator, SequenceNumber } from './sequence-number';

let receiveWindowWarningLastLogTime: number|undefined;
function logWarningAboutReceiveWindow() {
  let nowMS = present();
  if (receiveWindowWarningLastLogTime === undefined || nowMS > receiveWindowWarningLastLogTime + 1000) {
    // If you receive this warning, you might want to expire / lower the ttl on some lower priority messages that
    // have not been able to be sent as there is a limit to the range of messages sequence numbers that can potentially be in flight.
    console.warn('An outgoing message is blocked from sending due to unsent/unacknowledged messages that are old.');
    receiveWindowWarningLastLogTime = nowMS;
  }
}

/**
 * The wire format for a single Message
 */
export class WireMessage implements Serializable {
  public sequenceNumber = new SequenceNumber();
  public message!: Serializable;
  public serialize(stream: SerializationStream): void {
    this.sequenceNumber.serialize(stream);
    stream.serializeSerializable(this, 'message');
  }
}

export class OutgoingMessage {
  public priorityGrowthFactor = 1.0;
  public currentPriority = 0;
  public ttl?: number; // undefined => no ttl; number of times it will be considered for sending before automatically dropped
  public acked = false;
  public serializedLength: number;
  public wireMessage: WireMessage;
  constructor(public absoluteSequenceNumber: number, message: Serializable, public onAck?: () => void) {
    this.wireMessage = new WireMessage();
    this.wireMessage.sequenceNumber = new SequenceNumber(this.absoluteSequenceNumber);
    this.wireMessage.message = message;
    this.serializedLength = measureSerializable(this.wireMessage);
  }
  public expire() {
    this.ttl = 0;
  }
}

class OutgoingMessageChannel {
  constructor(private ackingPeer: AckingPeer, private classRegistry: ClassRegistry) {
  }

  public sendMessage(message: Serializable, onAck?: () => void): OutgoingMessage {
    let outboundMessage = new OutgoingMessage(this.getNextOutboundAbsoluteSequenceNumber(), message, onAck);
    this.messages.push(outboundMessage);
    return outboundMessage;
  }

  public flushMessagesToNetwork() {
    // Remove acked and expired messages
    // Update priority and reduce ttl
    // Find oldest absoluteSequencenumber that could still be sent
    let oldestOutgoingAbsoluteSequenceNumber = Infinity;
    this.messages = this.messages.filter((m) => {
      if (m.acked || m.ttl === 0) {
        // This message is no longer needed
        return false;
      }
      // Keep this message
      m.currentPriority += m.priorityGrowthFactor;
      if (m.ttl !== undefined) {
        m.ttl -= 1;
      }
      if (m.absoluteSequenceNumber < oldestOutgoingAbsoluteSequenceNumber) {
        oldestOutgoingAbsoluteSequenceNumber = m.absoluteSequenceNumber;
      }
      return true;
    });
    // This is one larger than the highest sequence number we can send that wont cause the receive window to be exceeded
    // The receive window is defined by IncomingMessageChannel's AbsoluteSequenceNumberTranslator
    let largestSendableAbsoluteSequenceNumberExclusive = oldestOutgoingAbsoluteSequenceNumber + AbsoluteSequenceNumberTranslator.halfwayPoint;
    let didSkipMessageDueToReceiveWindow = false;
    // With larger numbers of messages this becomes the dominant cost of the system.
    // I've tried using a priority queue, however the dynamic priorities mean that that you still pay
    // around O(n*log(n)) to update all the priorities and so this doesnt beat quicksort used by Array.sort()
    // There are data structures called "Kinetic Heaps" that might be able to do a better job here.
    // eg. https://citeseerx.ist.psu.edu/viewdoc/summary?doi=10.1.1.12.2739
    this.messages.sort((a, b) => {
      // Sort by currentPriority descending, followed by absoluteSequenceNumber ascending
      let relativePriority = b.currentPriority - a.currentPriority;
      if (relativePriority !== 0) {
        return relativePriority;
      } else {
        return a.absoluteSequenceNumber - b.absoluteSequenceNumber;
      }
    });
    // Get as many messages as we can fit in to 1 packet
    let maxLength = this.ackingPeer.getMtuForPayload();
    let messagesThatFit = new Array<OutgoingMessage>();
    let combinedLengthOfMessagesThatFit = 0;
    for (let message of this.messages) {
      let lengthIncludingNextMessage = combinedLengthOfMessagesThatFit + message.serializedLength;
      // Don't test length on the first message
      // If the first sendable message is too large, accept it and let webrtc deal with fragmentation
      if (messagesThatFit.length !== 0 && (lengthIncludingNextMessage > maxLength)) {
        // Skip this message as it would take us over the size limit
        continue;
      }
      if (message.absoluteSequenceNumber >= largestSendableAbsoluteSequenceNumberExclusive) {
        didSkipMessageDueToReceiveWindow = true;
        continue;
      }
      messagesThatFit.push(message);
      combinedLengthOfMessagesThatFit = lengthIncludingNextMessage;
      message.currentPriority = 0;
      // If we're less than 8 bytes from the maxLength, it's good enough
      // We're probably not going to find a small enough message to squeeze in, so break out
      if (combinedLengthOfMessagesThatFit > (maxLength - 8)) {
        break;
      }
    }
    if (didSkipMessageDueToReceiveWindow) {
      logWarningAboutReceiveWindow();
    }
    let combinedMessageBuffer = new ArrayBuffer(combinedLengthOfMessagesThatFit);
    let writeStream = new WriteStream(new DataView(combinedMessageBuffer), this.classRegistry);
    messagesThatFit.forEach((m) => {
      m.wireMessage.serialize(writeStream);
    });
    // Note that this sends even if the buffer is 0 length, this is currently useful to flush acks
    // but we can maybe do this less often, eg. only if there are acks to send or we hit some keepalive duration.
    this.ackingPeer.sendPacket(new Uint8Array(combinedMessageBuffer), () => {
      messagesThatFit.forEach((m) => {
        if (m.acked === false) {
          m.acked = true;
          if (m.onAck !== undefined) {
            m.onAck();
          }
        }
      });
    });
  }

  private nextOutboundAbsoluteSequenceNumber = 0;
  private getNextOutboundAbsoluteSequenceNumber(): number {
    let ret = this.nextOutboundAbsoluteSequenceNumber;
    this.nextOutboundAbsoluteSequenceNumber += 1;
    return ret;
  }
  private messages = new Array<OutgoingMessage>();
}

class IncomingMessageChannel {
  constructor(private ackingPacketPeer: AckingPeer, private classRegistry: ClassRegistry) {
    this.ackingPacketPeer.onPacketReceived.attach(this.handleIncomingPacket.bind(this));
  }
  public onMessageReceived = new SyncEvent<Serializable>();

  private handleIncomingPacket(payload: Uint8Array) {
    let readStream = new ReadStream(new DataView(payload.buffer, payload.byteOffset, payload.byteLength), this.classRegistry);
    while (readStream.hasMoreData()) {
      let wireMessage = new WireMessage();
      wireMessage.serialize(readStream);
      let absoluteSequenceNumber = this.absoluteSequenceNumberTranslator.getAbsoluteSequenceNumber(wireMessage.sequenceNumber);
      let alreadyReceivedQuery = this.messageAlreadyReceivedBuffer.getElement(absoluteSequenceNumber);
      if (alreadyReceivedQuery !== true) {
        this.messageAlreadyReceivedBuffer.setElement(absoluteSequenceNumber, true);
        this.onMessageReceived.post(wireMessage.message);
      }
    }
  }
  private absoluteSequenceNumberTranslator = new AbsoluteSequenceNumberTranslator();
  private messageAlreadyReceivedBuffer = new CyclicBuffer<boolean>(SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE / 4);
}

/**
 * Messages are unordered, prioritized individually,
 * and can be given a TTL / marked expired to limit reliability.
 */
export class MessagePeer {
  private outgoingMessageChannel = new OutgoingMessageChannel(this.ackingPeer, this.classRegistry);
  private incomingMessageChannel = new IncomingMessageChannel(this.ackingPeer, this.classRegistry);

  constructor(private ackingPeer: AckingPeer, private classRegistry: ClassRegistry) {
  }
  public onMessageReceived = this.incomingMessageChannel.onMessageReceived;
  public sendMessage(message: Serializable, onAck?: () => void): OutgoingMessage {
    return this.outgoingMessageChannel.sendMessage(message, onAck);
  }
  public flushMessagesToNetwork() {
    this.outgoingMessageChannel.flushMessagesToNetwork();
  }
}
