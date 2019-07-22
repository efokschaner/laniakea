// TODO figure out if this is necessary
// require('webrtc-adapter/out/adapter_no_edge_no_global.js')

import * as Bluebird from 'bluebird';
import * as lk from 'laniakea-shared';
import { Serializable } from 'laniakea-shared';
import { SyncEvent, VoidSyncEvent } from 'ts-events';

function logError(message: string) {
  return console.error(message);
}

class ClientRTCConnection extends lk.RTCPeerConnectionWithOpenDataChannels {
  constructor(
    peerConnection: RTCPeerConnection,
    reliableChannel: lk.BufferedRTCDataChannel,
    unreliableChannel: lk.BufferedRTCDataChannel) {
    super(peerConnection, reliableChannel, unreliableChannel);
  }
}

interface ConnectionAndPlayerId {
  connection: ClientRTCConnection;
  assignedPlayerId: lk.PlayerId;
}

function connectToRTCServer(serverWsUrl: string): Bluebird<ConnectionAndPlayerId> {
  let websocketForCleanup: WebSocket | undefined = undefined;
  let assignedPlayerId: number | undefined;
  return new Bluebird<{ websocket: WebSocket, peerConnection: RTCPeerConnection }>((resolve, reject) => {
    let peerConnection = new RTCPeerConnection(undefined);
    let websocket = new WebSocket(serverWsUrl);
    websocketForCleanup = websocket;
    websocket.onmessage = (evt) => {
      console.log('connectedWsClient.onmessage', evt);
      let message = JSON.parse(evt.data);
      if (message.desc) {
        let desc = message.desc;
        if (desc.type === 'answer') {
          peerConnection.setRemoteDescription(desc).catch(logError);
        } else {
          console.log('Unhandled session description mesage', desc);
        }
      } else if (message.candidate) {
        peerConnection.addIceCandidate(message.candidate).catch(logError);
      } else if (message.playerIdAssignment !== undefined) {
        assignedPlayerId = message.playerIdAssignment;
      } else {
        console.log('Unhandled ws mesage', message);
      }
    };
    websocket.onopen = (openEvent) => {
      console.log('wsClient.onopen', openEvent);
      resolve({ websocket, peerConnection })
    }
    websocket.onclose = (closeEvent) => {
      console.log('wsClient.onclose', closeEvent);
      reject(new Error(closeEvent.code + ' ' + closeEvent.reason));
    };
    websocket.onerror = (error) => {
      // Connection failures result in an onclose judging from
      // https://www.w3.org/TR/websockets/#concept-websocket-close-fail
      // So here we just log.
      console.log('websocket.onerror', error);
    };
  }).then(({ websocket, peerConnection }) => {
    return new Bluebird<ConnectionAndPlayerId>((resolve, reject) => {
      // send any ice candidates to the other peer
      peerConnection.onicecandidate = (evt) => {
        websocket.send(JSON.stringify({ candidate: evt.candidate }));
      };
      // let the "negotiationneeded" event trigger offer generation
      peerConnection.onnegotiationneeded = () => {
        peerConnection.createOffer().then((offer) => {
          return peerConnection.setLocalDescription(offer);
        })
          .then(() => {
            // send the offer to the other peer
            websocket.send(JSON.stringify({ desc: peerConnection.localDescription }));
          })
          .catch(logError);
      };
      // Because we're waiting for two channels to open,
      // it's possible for messages to arrive on one before
      // the other is complete, so listeners wont be ready.
      // To compensate, we buffer both channels and let the
      // listeners call flushAndStopBuffering when they're ready
      let reliableChannel = lk.bufferRTCDataChannel(
        peerConnection.createDataChannel('reliable'));
      reliableChannel.binaryType = 'arraybuffer';
      let reliableChannelIsOpen = false;
      let unreliableChannel = lk.bufferRTCDataChannel(
        peerConnection.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 }));
      unreliableChannel.binaryType = 'arraybuffer';
      let unreliableChannelIsOpen = false;
      function onChannelOpen() {
        if (reliableChannelIsOpen && unreliableChannelIsOpen) {
          if (assignedPlayerId === undefined) {
            // This should never happen as playerId should be transmitted before rtc stuff.
            reject(new Error('Expected to have assignedPlayerId before connection was fully open.'));
          } else {
            resolve({
              assignedPlayerId,
              connection: new ClientRTCConnection(
                peerConnection,
                reliableChannel,
                unreliableChannel,
              ),
            });
          }
        }
      }
      reliableChannel.onopen = () => {
        reliableChannelIsOpen = true;
        onChannelOpen();
      };
      reliableChannel.onerror = (event) => {
        reject(new Error(event.error && event.error.message || 'No message available, missing event.error'));
      };
      reliableChannel.onclose = () => {
        reject(new Error('Reliable channel closed during startup.'));
      };
      unreliableChannel.onopen = () => {
        unreliableChannelIsOpen = true;
        onChannelOpen();
      };
      unreliableChannel.onerror = (event) => {
        reject(new Error(event.error && event.error.message || 'No message available, missing event.error'));
      };
      unreliableChannel.onclose = () => {
        reject(new Error('Unreliable channel closed during startup.'));
      };
    });
  }).finally(() => {
    if (websocketForCleanup) {
      websocketForCleanup.close();
    }
  });
}

export class NetworkClient {
  constructor() {
    this.packetPeer = new lk.PacketPeer();
  }

  public connect(serverWsUrl: string): Bluebird<void> {
    return connectToRTCServer(serverWsUrl).then((connectResult) => {
      this.rtcConnection = connectResult.connection;
      this.rtcConnection.onClose.attach(() => this.handleDisconnect());
      this.packetPeer.attachToConnection(this.rtcConnection);
      this.isConnected = true;
      this.onConnected.post(connectResult.assignedPlayerId);
      // TODO figure out if flushAndStopBuffering needs to be done or if
      // re-architecture can eliminate it (by hooking up handlers before connecting)
      // If it IS necessary, is this the right place to do it?
      this.rtcConnection.flushAndStopBuffering();
    }).tapCatch(() => this.handleDisconnect());
  }

  public close() {
    if (this.rtcConnection !== undefined) {
      this.rtcConnection.close();
    }
  }

  public isConnected = false;
  // Carries our assigned playerId
  public onConnected = new SyncEvent<lk.PlayerId>();
  public onDisconnected = new VoidSyncEvent();

  /*
   * All PacketTypes you will send or receive must be registered for serialisation / deserialisation
   */
  public registerPacketType<T extends Serializable>(
    ctor: new (...args: any[]) => T,
    uniquePacketTypeName: string,
  ): void {
    return this.packetPeer.registerPacketType(ctor, uniquePacketTypeName);
  }

  public registerPacketHandler<T extends Serializable>(
    ctor: new (...args: any[]) => T,
    handler: (t: T, sequenceNumber: number) => void,
  ): void {
    return this.packetPeer.registerPacketHandler(ctor, handler);
  }

  public sendPacket(packet: Serializable, onAck?: () => void) {
    return this.packetPeer.sendPacket(packet, onAck);
  }

  private rtcConnection?: ClientRTCConnection;
  private packetPeer = new lk.PacketPeer();

  private handleDisconnect() {
    if (this.rtcConnection) {
      this.rtcConnection.close();
    }
    this.rtcConnection = undefined;
    this.isConnected = false;
    this.onDisconnected.post();
  }
}
