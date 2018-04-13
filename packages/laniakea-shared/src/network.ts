const present = require('present');
import { SyncEvent } from 'ts-events';
import { CyclicBuffer } from './cyclic-buffer';
import * as reflection from './reflection';
import {
  MeasureStream,
  ReadStream,
  Serializable,
  SerializationStream,
  WriteStream,
  measureAndSerialize
} from './serialization';




declare global {
  // Apply some improvements to RTCPeerConnection's interface

  // https://www.w3.org/TR/webrtc/#idl-def-rtcdatachannelinit
  interface RTCDataChannelInit {
    ordered?: boolean; // default = true
    maxPacketLifeTime?: number;
    maxRetransmits?: number;
    protocol?: string; // default = ''
    negotiated?: boolean; // default = false
    id?: number;
  }

  // https://www.w3.org/TR/webrtc/#idl-def-rtcdatachannelstate
  type RTCDataChannelState = 'connecting' | 'open' | 'closing' | 'closed';

  // https://www.w3.org/TR/websockets/#dom-websocket-binarytype
  type RTCBinaryType = 'blob' | 'arraybuffer';

  // https://www.w3.org/TR/webrtc/#idl-def-rtcdatachannel
  interface RTCDataChannel extends EventTarget {
    readonly label: string;
    readonly ordered: boolean;
    readonly maxPacketLifeTime: number | null;
    readonly maxRetransmits: number | null;
    readonly protocol: string;
    readonly negotiated: boolean;
    readonly id: number;
    readonly readyState: RTCDataChannelState;
    readonly bufferedAmount: number;
    bufferedAmountLowThreshold: number;
    binaryType: RTCBinaryType;

    close(): void;
    send(data: string | Blob | ArrayBuffer | ArrayBufferView): void;

    onopen: (event: Event) => void;
    onmessage: (event: MessageEvent) => void;
    onbufferedamountlow: (event: Event) => void;
    onerror: (event: ErrorEvent) => void;
    onclose: (event: Event) => void;
  }

    // https://www.w3.org/TR/webrtc/#h-rtcdatachannelevent
  interface RTCDataChannelEvent {
    readonly channel: RTCDataChannel;
  }

  interface RTCPeerConnection {
    createDataChannel(label: string | null, dataChannelDict?: RTCDataChannelInit): RTCDataChannel;
    ondatachannel: (event: 	RTCDataChannelEvent) => void;
  }
}


// Buffers RTCDataChannel recieved messages until the
// flushAndStopBuffering function is called.
// Do not touch the onmessage attribute on the datachannel
// or the guarantees could be violated.
// Use onflushedmessage instead of onmessage to subscribe.
// I've looked into other ways to do this and nothing short of
// duplicating the full interface of RTCDataChannel seems safe
// so thanks Javascript...
export interface BufferedRTCDataChannel extends RTCDataChannel {
  onflushedmessage: ((event: MessageEvent) => void) | null;
  flushAndStopBuffering(): void;
}

export function bufferRTCDataChannel(dataChannel: RTCDataChannel) : BufferedRTCDataChannel {
  var bufferedChannel = dataChannel as BufferedRTCDataChannel & { _bufferedMessages: MessageEvent[]; };
  bufferedChannel._bufferedMessages = [];
  bufferedChannel.onmessage = evt => {
    bufferedChannel._bufferedMessages.push(evt);
  };
  bufferedChannel.onflushedmessage = null;
  bufferedChannel.flushAndStopBuffering = function() {
    if(bufferedChannel.onflushedmessage) {
      while(bufferedChannel._bufferedMessages.length > 0) {
        bufferedChannel.onflushedmessage(
          bufferedChannel._bufferedMessages.shift() as MessageEvent);
      }
      bufferedChannel.onmessage = bufferedChannel.onflushedmessage;
    } else {
      console.warn('RTCDataChannel messages were flushed when there was no handler.');
      bufferedChannel._bufferedMessages = [];
    }
  }
  return bufferedChannel;
}

export class RTCPeerConnectionWithOpenDataChannels {
  public onReliableData = new SyncEvent<ArrayBuffer>();
  public onUnreliableData = new SyncEvent<ArrayBuffer>();
  public onClose = new SyncEvent<this>();
  private _isClosing = false;
  constructor(
      public peerConnection: RTCPeerConnection,
      private reliableChannel: BufferedRTCDataChannel,
      private unreliableChannel: BufferedRTCDataChannel) {
    this._addHandlers(this.reliableChannel, this.onReliableData);
    this._addHandlers(this.unreliableChannel, this.onUnreliableData);
  }

  sendReliable(data: ArrayBuffer | ArrayBufferView): void {
    this.reliableChannel.send(data);
  }

  sendUnreliable(data: ArrayBuffer | ArrayBufferView): void {
    this.unreliableChannel.send(data);
  }

  close() {
    if(!this._isClosing) {
      this._isClosing = true;
      this.reliableChannel.close();
      this.unreliableChannel.close();
      this.peerConnection.close();
      this.onClose.post(this);
    }
  }

  flushAndStopBuffering() {
    this.reliableChannel.flushAndStopBuffering();
    this.unreliableChannel.flushAndStopBuffering();
  }

  _addHandlers(datachannel: BufferedRTCDataChannel, eventEmitter: SyncEvent<ArrayBuffer>) {
    datachannel.onflushedmessage = message => {
      eventEmitter.post(message.data);
    };
    datachannel.onerror = error => {
      console.error('datachannel error:', error, 'Datachannel:', datachannel);
    };
    datachannel.onclose = () => {
      this.close();
    }
  }
}

// https://groups.google.com/d/msg/discuss-webrtc/LZsm-jbP0zA/JITEhtx4HAQJ
export let webRTC_MTU = 1131;

let SEQUENCE_NUMBER_BYTES = 2;
let MAX_SEQUENCE_NUMBER_EXCLUSIVE = (2**8)**SEQUENCE_NUMBER_BYTES;
let ACK_BITFIELD_BYTES = 4;

function sequenceNumberIsGreaterThan(lhs: number, rhs: number){
  let halfRange = MAX_SEQUENCE_NUMBER_EXCLUSIVE / 2;
  let diff = lhs - rhs;
  return ((diff > 0) && (diff <= halfRange)) || diff < -halfRange;
}

function normalizeSequenceNumber(num: number) {
  return mod(num, MAX_SEQUENCE_NUMBER_EXCLUSIVE);
}

function incrementSequenceNumber(num: number) {
  return normalizeSequenceNumber(num + 1);
}

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

class Packet implements Serializable {
  sequenceNumber!: number; // SEQUENCE_NUMBER_BYTES
  ackSequenceNumber!: number; // SEQUENCE_NUMBER_BYTES
  ackBitfield!: number; // ACK_BITFIELD_BITS
  payload!: Uint8Array;

  serialize(stream: SerializationStream) {
    stream.serializeUint16(this, 'sequenceNumber');
    stream.serializeUint16(this, 'ackSequenceNumber');
    stream.serializeUint32(this, 'ackBitfield');
    stream.serializeUint8Array(this, 'payload');
  }
}

class SentPacketData {
  sendTimeS: number;
  onAck?: () => void;
  ackedTimeS?: number;
  constructor(sendTimeS: number) {
    this.sendTimeS = sendTimeS;
  }
}

class ReceivedPacketData {
}

/**
 * Wraps RTCPeerConnectionWithOpenDataChannels
 * Handles packet acking / rtt estimation
 * and other fun stuff
 */
export class AckingPacketProtocol {
  constructor(
    private openRtcPeerConnection: RTCPeerConnectionWithOpenDataChannels
  ) {
    console.assert(mod(MAX_SEQUENCE_NUMBER_EXCLUSIVE, this.packetHistoryBufferSize) == 0);
    openRtcPeerConnection.onUnreliableData.attach(this.handleIncomingPacket.bind(this));
  }

  // Exposing the sequence number allows higher level systems to know whether
  // this payload is new data that supersedes old data.
  onPacketReceived = new SyncEvent<{payload: Uint8Array, sequenceNumber: number}>();

  sendPacket(payload: Uint8Array, onAck?: () => void) {
    let outboundPacket = new Packet();
    outboundPacket.sequenceNumber = this.getNextOutboundSequenceNumber();
    outboundPacket.ackSequenceNumber = this.highestReceivedSequenceNumber;
    outboundPacket.ackBitfield = 0;
    for(let i = 0; i < ACK_BITFIELD_BYTES * 8; ++i) {
      let sequenceNumberRepresentedByBit = mod(outboundPacket.ackSequenceNumber - 1 - i, MAX_SEQUENCE_NUMBER_EXCLUSIVE);
      let receivedPacketEntry = this.receivedPacketsHistory.getElement(sequenceNumberRepresentedByBit);
      if(receivedPacketEntry !== undefined) {
        outboundPacket.ackBitfield |= 1 << i;
      }
    }
    outboundPacket.payload = payload;
    let sentPacketData = new SentPacketData(present() / 1000);
    sentPacketData.onAck = onAck;
    this.sentPacketsHistory.setElement(outboundPacket.sequenceNumber, sentPacketData);
    this.lastSentAckSequenceNumber = outboundPacket.ackSequenceNumber;
    let outboundBuffer = measureAndSerialize(outboundPacket, undefined);
    this.openRtcPeerConnection.sendUnreliable(outboundBuffer);
  }

  // EXPENSIVE DEBUG ONLY
  // TODO make configurable and compute eagerly to reduce cost
  getRttEstimate() {
    let numberCounted = 0;
    let cumulativeMovingAverageRtt = 0;
    for(let entry of this.sentPacketsHistory.entries) {
      if(entry.data && entry.data.ackedTimeS) {
        numberCounted += 1;
        let sampledRtt = entry.data.ackedTimeS - entry.data.sendTimeS;
        cumulativeMovingAverageRtt = cumulativeMovingAverageRtt + (sampledRtt - cumulativeMovingAverageRtt) / numberCounted;
      }
    }
    return cumulativeMovingAverageRtt;
  }

  // EXPENSIVE DEBUG ONLY
  // TODO make configurable and compute eagerly to reduce cost
  getFractionAcked() {
    let sentCount = 0;
    let ackedCount = 0;
    for(let entry of this.sentPacketsHistory.entries) {
      if(entry.data !== undefined) {
        ++sentCount;
        if(entry.data.ackedTimeS !== undefined) {
          ++ackedCount;
        }
      }
    }
    return `${sentCount} / ${ackedCount} = ${100 * sentCount / ackedCount}%`;
  }

  private packetHistoryBufferSize = 512;
  private sentPacketsHistory = new CyclicBuffer<SentPacketData>(this.packetHistoryBufferSize);
  private receivedPacketsHistory = new CyclicBuffer<ReceivedPacketData>(this.packetHistoryBufferSize);
  private nextOutboundSequenceNumber = 0;
  private getNextOutboundSequenceNumber(): number {
    let ret = this.nextOutboundSequenceNumber;
    this.nextOutboundSequenceNumber = incrementSequenceNumber(this.nextOutboundSequenceNumber);
    return ret;
  }
  private highestReceivedSequenceNumber = -1;
  private lastSentAckSequenceNumber = -1;
  private processAck(sentSequenceNumber: number, receivedTimeS: number) {
    let sentPacketEntry = this.sentPacketsHistory.getElement(sentSequenceNumber);
    if (sentPacketEntry !== undefined && sentPacketEntry.ackedTimeS === undefined) {
      sentPacketEntry.ackedTimeS = receivedTimeS;
      if(sentPacketEntry.onAck !== undefined) {
        sentPacketEntry.onAck();
        sentPacketEntry.onAck = undefined;
      }
    }
  }
  private handleIncomingPacket(data: ArrayBuffer) {
    let inboundPacket = new Packet();
    inboundPacket.serialize(new ReadStream(new DataView(data), undefined));
    if(sequenceNumberIsGreaterThan(inboundPacket.sequenceNumber, this.highestReceivedSequenceNumber)) {
      for(let i = incrementSequenceNumber(this.highestReceivedSequenceNumber);
          sequenceNumberIsGreaterThan(inboundPacket.sequenceNumber, i);
          i = incrementSequenceNumber(i)) {
        this.receivedPacketsHistory.clearElement(i);
      }
      this.highestReceivedSequenceNumber = inboundPacket.sequenceNumber;
    }
    this.receivedPacketsHistory.setElement(inboundPacket.sequenceNumber, new ReceivedPacketData());
    let receivedTimeS = present() / 1000;
    this.processAck(inboundPacket.ackSequenceNumber, receivedTimeS);
    for(let i = 0; i < ACK_BITFIELD_BYTES * 8; ++i) {
      let bitMask = 1 << i;
      if(bitMask & inboundPacket.ackBitfield) {
        let sequenceNumberRepresentedByBit = mod(inboundPacket.ackSequenceNumber - 1 - i, MAX_SEQUENCE_NUMBER_EXCLUSIVE);
        this.processAck(sequenceNumberRepresentedByBit, receivedTimeS);
      }
    }
    // If we've received multiple packets without having transmitted any, send an empty ack packet so that the
    // other end knows we're getting them.
    let halfTheAckRangeOfAPacket = ACK_BITFIELD_BYTES * 4;
    if(sequenceNumberIsGreaterThan(
      inboundPacket.sequenceNumber,
      this.lastSentAckSequenceNumber + halfTheAckRangeOfAPacket)) {
      // This implies we have half a packet's ack capacity of un-acked packets to ack
      // Send a packet with zero length payload so that we transmit some acks.
      this.sendPacket(new Uint8Array(0));
    }
    // Only event on packets that have a non-zero payload.
    // Zero length payloads can be used to transmit acks when there's nothing else to send.
    if(inboundPacket.payload.length > 0) {
      this.onPacketReceived.post(inboundPacket);
    }
  }
}

// Provides routing of different payload types to different callbacks
export class PacketPayloadRouter {
  constructor() {
  }

  /*
   * All PacketTypes you will send or receive must be registered for serialisation / deserialisation
   */
  registerPacketType<T extends Serializable>(
    ctor: {new(...args: any[]):T},
    uniquePacketTypeName: string
  ): void {
    this.classRegistry.registerClass(ctor, uniquePacketTypeName);
  }

  /*
   * Add handlers for any packet type you wish to handle
   */
  registerHandler<T extends Serializable>(
    ctor: {new(...args: any[]):T},
    handler: (t: T, sequenceNumber: number) => void) : void {
    this.callbacks.set(ctor, handler);
  }

  handleRoutedPacket({payload, sequenceNumber}: {payload: Uint8Array, sequenceNumber: number}): void {
    let dataView = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    let readStream = new ReadStream(dataView, this.classRegistry);
    let readResult: {packet: Serializable|undefined } = { packet: undefined };
    readStream.serializeSerializable(readResult, 'packet');
    let packet = readResult.packet!;
    let maybeCb = this.callbacks.get(packet.constructor);
    if (maybeCb == undefined) {
      console.error(`No handler registered for packet type: ${packet.constructor.name}`)
      return;
    }
    maybeCb(packet, sequenceNumber);
  }

  serializeRoutedPacket(packet: Serializable): ArrayBuffer {
    let measureStream = new MeasureStream();
    let packetWrapper = {packet};
    measureStream.serializeSerializable(packetWrapper, 'packet');
    let writeBuffer = new ArrayBuffer(measureStream.getNumBytesWritten());
    let writeStream = new WriteStream(new DataView(writeBuffer), this.classRegistry);
    writeStream.serializeSerializable(packetWrapper, 'packet');
    return writeBuffer;
  }

  private classRegistry = new reflection.ClassRegistry();
  private callbacks: Map<Function, (p: any, sequenceNumber: number) => void> = new Map();
}


/*
 * This class does the recoupling of all the different networking layers,
 * to remove boilerplate from client and server.
 */
export class PacketPeer {
  constructor() {
  }

  attachToConnection(openRtcPeerConnection: RTCPeerConnectionWithOpenDataChannels) {
    this.ackingTransport = new AckingPacketProtocol(openRtcPeerConnection);
    this.ackingTransport.onPacketReceived.attach(this.packetRouter.handleRoutedPacket.bind(this.packetRouter));
  }

  /*
   * All PacketTypes you will send or receive must be registered for serialisation / deserialisation
   */
  registerPacketType<T extends Serializable>(
    ctor: {new(...args: any[]):T},
    uniquePacketTypeName: string
  ): void {
    return this.packetRouter.registerPacketType(ctor, uniquePacketTypeName);
  }

  registerPacketHandler<T extends Serializable>(
    ctor: {new(...args: any[]):T},
    handler: (t: T, sequenceNumber: number) => void
  ): void {
    this.packetRouter.registerHandler(ctor, handler);
  }

  sendPacket(packet: Serializable, onAck?: () => void) {
    if(this.ackingTransport) {
      let payload = new Uint8Array(this.packetRouter.serializeRoutedPacket(packet));
      this.ackingTransport.sendPacket(payload, onAck);
    }
  }

  getRttEstimate() {
    return this.ackingTransport ? this.ackingTransport.getRttEstimate() : 0;
  }

  getFractionAcked() {
    return this.ackingTransport ? this.ackingTransport.getFractionAcked() : 0;
  }

  private ackingTransport?: AckingPacketProtocol;
  private packetRouter = new PacketPayloadRouter();
}
