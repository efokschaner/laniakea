// tslint:disable-next-line:no-var-requires
const present = require('present');

import { SyncEvent } from 'ts-events';
import { CyclicBuffer } from '../cyclic-buffer';
import { measureAndSerialize, measureSerializable, ReadStream, Serializable, SerializationStream } from '../serialization';
import { SequenceNumber } from './sequence-number';
import { LikeRTCDataChannelOrWebSocket } from './socket-abstraction';

let ACK_BITFIELD_BYTES = 4;

class Packet implements Serializable {
  public sequenceNumber = new SequenceNumber();
  public ackSequenceNumber = new SequenceNumber();
  public ackBitfield = 0; // ACK_BITFIELD_BYTES
  public payload!: Uint8Array;

  public serialize(stream: SerializationStream) {
    this.sequenceNumber.serialize(stream);
    this.ackSequenceNumber.serialize(stream);
    stream.serializeUint32(this, 'ackBitfield');
    // TODO: we can save serializing length of the payload buffer because the
    // underlying protocol carries the length and we can assume 1 Packet per webrtc Message from the browser
    stream.serializeUint8Array(this, 'payload');
  }
}

class SentPacketData {
  public sendTimeS: number;
  public onAck?: () => void;
  public ackedTimeS?: number;
  constructor(sendTimeS: number) {
    this.sendTimeS = sendTimeS;
  }
}

class ReceivedPacketData {
}

/**
 * This is the largest number of bytes we should send in a data channel payload
 * to avoid fragmentation. It's not a guaranteed fact as MTU is not a constant.
 * So this is a conservative estimate.
 * See this for derivation:
 * https://groups.google.com/d/msg/discuss-webrtc/LZsm-jbP0zA/JITEhtx4HAQJ
 */
let webRtcDataChannelPayloadMTU = 1131;

function calculatePayloadMTU(): number {
  let dummyPacket = new Packet();
  dummyPacket.payload = new Uint8Array(0);
  let ackingPacketOverhead = measureSerializable(dummyPacket);
  return webRtcDataChannelPayloadMTU - ackingPacketOverhead;
}

let ackingPacketProtocolPayloadMTU = calculatePayloadMTU();

/**
 * Wraps RTCDataChannel or WebSocket
 * Handles packet acking / rtt estimation
 * and other fun stuff
 */
export class AckingPeer {
  constructor(
    private channel: LikeRTCDataChannelOrWebSocket,
  ) {
    console.assert(SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE % this.packetHistoryBufferSize === 0);
    this.channel.onmessage = this.onChannelMessage.bind(this);
  }

  public getMtuForPayload() {
    return ackingPacketProtocolPayloadMTU;
  }

  public onPacketReceived = new SyncEvent<Uint8Array>();

  public sendPacket(payload: Uint8Array, onAck?: () => void) {
    if (payload.byteLength > this.getMtuForPayload()) {
      console.warn(`payload is ${payload.byteLength} bytes, which is larger than getMtuForPayload(): ${this.getMtuForPayload()}. Fragmentation may occur.`);
    }
    let outboundPacket = new Packet();
    outboundPacket.sequenceNumber = this.getNextOutboundSequenceNumber();
    outboundPacket.ackSequenceNumber = this.highestReceivedSequenceNumber;
    outboundPacket.ackBitfield = 0;
    for (let i = 0; i < ACK_BITFIELD_BYTES * 8; ++i) {
      let sequenceNumberRepresentedByBit = outboundPacket.ackSequenceNumber.add( -1 - i);
      let receivedPacketEntry = this.receivedPacketsHistory.getElement(sequenceNumberRepresentedByBit.value);
      if (receivedPacketEntry !== undefined) {
        // tslint:disable-next-line:no-bitwise
        outboundPacket.ackBitfield |= 1 << i;
      }
    }
    outboundPacket.payload = payload;
    let sentPacketData = new SentPacketData(present() / 1000);
    sentPacketData.onAck = onAck;
    this.sentPacketsHistory.setElement(outboundPacket.sequenceNumber.value, sentPacketData);
    this.lastSentAckSequenceNumber = outboundPacket.ackSequenceNumber;
    let outboundBuffer = measureAndSerialize(outboundPacket, undefined);
    this.channel.send(outboundBuffer);
  }

  // EXPENSIVE DEBUG ONLY
  // TODO make configurable and compute eagerly to reduce cost
  // TODO exclude outliers
  public getRttEstimate() {
    let numberCounted = 0;
    let cumulativeMovingAverageRtt = 0;
    for (let entry of this.sentPacketsHistory.entries) {
      if (entry.data && entry.data.ackedTimeS) {
        numberCounted += 1;
        let sampledRtt = entry.data.ackedTimeS - entry.data.sendTimeS;
        cumulativeMovingAverageRtt = cumulativeMovingAverageRtt + (sampledRtt - cumulativeMovingAverageRtt) / numberCounted;
      }
    }
    return cumulativeMovingAverageRtt;
  }

  // EXPENSIVE DEBUG ONLY
  // TODO make configurable and compute eagerly to reduce cost
  public getFractionAcked() {
    let sentCount = 0;
    let ackedCount = 0;
    for (let entry of this.sentPacketsHistory.entries) {
      if (entry.data !== undefined) {
        ++sentCount;
        if (entry.data.ackedTimeS !== undefined) {
          ++ackedCount;
        }
      }
    }
    return `${sentCount} / ${ackedCount} = ${100 * sentCount / ackedCount}%`;
  }

  /**
   * This buffer is needed to store information about packets we might reasonably still hear an ACK for.
   * Estimated number of packets to track = (Maximum RTT for a network route on Earth) * (Upper limit on packets sent per second)
   * Based on this fun article https://fgiesen.wordpress.com/2018/01/20/network-latencies-and-speed-of-light/
   * decent internet routes packets at around 1/3rd the speed of light traveling between the same points.
   * The "farthest" distance a hypothetical packet would travel round trip is the circumference of the earth.
   * We'll add a 2x safety factor to this RTT for jitter and other things.
   * Upper limit on packets sent per second: We have more control of this,
   * lets support 2 packets per game frame at 60 fps, so 120 packets per second as an upper limit.
   *
   * = (2 * (circumference of earth) / (speed of light / 3)) * (max pps we support)
   * = 0.8 * 120
   * = 96
   * round up to power of 2 for elegance + a little more safety
   * = 128
   */
  private packetHistoryBufferSize = 128;
  private sentPacketsHistory = new CyclicBuffer<SentPacketData>(this.packetHistoryBufferSize);
  private receivedPacketsHistory = new CyclicBuffer<ReceivedPacketData>(this.packetHistoryBufferSize);
  private nextOutboundSequenceNumber = new SequenceNumber(0);
  private getNextOutboundSequenceNumber(): SequenceNumber {
    let ret = this.nextOutboundSequenceNumber;
    this.nextOutboundSequenceNumber = this.nextOutboundSequenceNumber.add(1);
    return ret;
  }
  private highestReceivedSequenceNumber = new SequenceNumber(-1);
  private lastSentAckSequenceNumber = new SequenceNumber(-1);
  private onChannelMessage(ev: MessageEvent): void {
    this.handleIncomingPacket(ev.data);
  }
  private processAck(sentSequenceNumber: number, receivedTimeS: number) {
    let sentPacketEntry = this.sentPacketsHistory.getElement(sentSequenceNumber);
    if (sentPacketEntry !== undefined && sentPacketEntry.ackedTimeS === undefined) {
      sentPacketEntry.ackedTimeS = receivedTimeS;
      if (sentPacketEntry.onAck !== undefined) {
        sentPacketEntry.onAck();
        sentPacketEntry.onAck = undefined;
      }
    }
  }
  private handleIncomingPacket(data: ArrayBuffer) {
    let inboundPacket = new Packet();
    inboundPacket.serialize(new ReadStream(new DataView(data), undefined));
    if (inboundPacket.sequenceNumber.isGreaterThan(this.highestReceivedSequenceNumber)) {
      for (let i = this.highestReceivedSequenceNumber.add(1);
          inboundPacket.sequenceNumber.isGreaterThan(i);
          i = i.add(1)) {
        this.receivedPacketsHistory.clearElement(i.value);
      }
      this.highestReceivedSequenceNumber = inboundPacket.sequenceNumber;
    }
    this.receivedPacketsHistory.setElement(inboundPacket.sequenceNumber.value, new ReceivedPacketData());
    let receivedTimeS = present() / 1000;
    this.processAck(inboundPacket.ackSequenceNumber.value, receivedTimeS);
    for (let i = 0; i < ACK_BITFIELD_BYTES * 8; ++i) {
      // tslint:disable-next-line:no-bitwise
      let bitMask = 1 << i;
      // tslint:disable-next-line:no-bitwise
      if (bitMask & inboundPacket.ackBitfield) {
        let sequenceNumberRepresentedByBit = inboundPacket.ackSequenceNumber.add(-1 - i);
        this.processAck(sequenceNumberRepresentedByBit.value, receivedTimeS);
      }
    }
    // If we've received multiple packets without having transmitted any, send an empty ack packet so that the
    // other end knows we're getting them.
    let halfTheAckRangeOfAPacket = ACK_BITFIELD_BYTES * 4;
    if (inboundPacket.sequenceNumber.isGreaterThan(this.lastSentAckSequenceNumber.add(halfTheAckRangeOfAPacket))) {
      // This implies we have half a packet's ack capacity of un-acked packets to ack
      // Send a packet with zero length payload so that we transmit some acks.
      this.sendPacket(new Uint8Array(0));
    }
    // Only event on packets that have a non-zero payload.
    // Zero length payloads can be used to transmit acks when there's nothing else to send.
    if (inboundPacket.payload.length > 0) {
      this.onPacketReceived.post(inboundPacket.payload);
    }
  }
}
