// TODO figure out if this is necessary
//require('webrtc-adapter/out/adapter_no_edge_no_global.js')

import {VoidSyncEvent, SyncEvent} from 'ts-events';
import * as Bluebird from 'bluebird';
import * as lk from 'laniakea-shared';
import { Serializable } from 'laniakea-shared';

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
  let disposableWebsocket = Bluebird.try(function() {
    return new WebSocket(serverWsUrl);
  }).disposer((ws) => { ws.close()});
  return Bluebird.using(disposableWebsocket, function(wsClient) {
    return new Bluebird<WebSocket>(function(resolve, reject) {
      wsClient.onopen = (openEvent) => {
        console.log('wsClient.onopen', openEvent);
        resolve(wsClient);
      };
      wsClient.onclose = (closeEvent) => {
        console.log('wsClient.onclose', closeEvent);
        reject(new Error(closeEvent.code + ' ' + closeEvent.reason));
      };
      wsClient.onerror = (error) => {
        // Connection failures result in an onclose judging from
        // https://www.w3.org/TR/websockets/#concept-websocket-close-fail
        // So here we just log.
        console.log('wsClient.onerror', error);
      };
    })
    .then(function(connectedWsClient) {
      let assignedPlayerId : number|undefined = undefined;
      connectedWsClient.onmessage = (evt) => {
        console.log('connectedWsClient.onmessage', evt);
        var message = JSON.parse(evt.data);
        if (message.desc) {
          var desc = message.desc;
          if (desc.type == 'answer') {
            peerConnection.setRemoteDescription(desc).catch(logError);
          } else {
            console.log('Unhandled session description mesage', desc);
          }
        } else if (message.candidate) {
          peerConnection.addIceCandidate(message.candidate).catch(logError);
        } else if (message.playerIdAssignment) {
          assignedPlayerId = message.playerIdAssignment;
        } else {
          console.log('Unhandled ws mesage', message);
        }
      };
      // RTCPeerConnection's configuration is optional
      var peerConnection = new RTCPeerConnection(undefined as any as RTCConfiguration);
      // send any ice candidates to the other peer
      peerConnection.onicecandidate = function (evt) {
        connectedWsClient.send(JSON.stringify({ "candidate": evt.candidate }));
      };
      // let the "negotiationneeded" event trigger offer generation
      peerConnection.onnegotiationneeded = function () {
        peerConnection.createOffer().then(function (offer) {
          return peerConnection.setLocalDescription(offer);
        })
        .then(function () {
          // send the offer to the other peer
          connectedWsClient.send(JSON.stringify({ "desc": peerConnection.localDescription }));
        })
        .catch(logError);
      };
      // Because we're waiting for two channels to open,
      // it's possible for messages to arrive on one before
      // the other is complete, so listeners wont be ready.
      // To compensate, we buffer both channels and let the
      // listeners call flushAndStopBuffering when they're ready
      var reliableChannel = lk.bufferRTCDataChannel(
        peerConnection.createDataChannel('reliable'));
      reliableChannel.binaryType = 'arraybuffer';
      var reliableChannelIsOpen = false;
      var unreliableChannel = lk.bufferRTCDataChannel(
        peerConnection.createDataChannel('unreliable', { ordered: false, maxRetransmits: 0 }));
      unreliableChannel.binaryType = 'arraybuffer';
      var unreliableChannelIsOpen = false;
      return new Bluebird<ConnectionAndPlayerId>(function(resolve, reject) {
        function onChannelOpen() {
          if(reliableChannelIsOpen && unreliableChannelIsOpen) {
            if(assignedPlayerId === undefined) {
              // This should never happen as playerId should be transmitted before rtc stuff.
              reject(new Error('Expected to have assignedPlayerId before connection was fully open.'));
            } else {
              resolve({
                connection: new ClientRTCConnection(
                  peerConnection,
                  reliableChannel,
                  unreliableChannel
                ),
                assignedPlayerId: assignedPlayerId
              });
            }
          }
        }
        reliableChannel.onopen = function () {
          reliableChannelIsOpen = true;
          onChannelOpen();
        };
        reliableChannel.onerror = error => {
          reject(new Error(error.message));
        };
        reliableChannel.onclose = () => {
          reject(new Error('Reliable channel closed during startup.'));
        }
        unreliableChannel.onopen = function () {
          unreliableChannelIsOpen = true;
          onChannelOpen();
        };
        unreliableChannel.onerror = error => {
          reject(new Error(error.message));
        };
        unreliableChannel.onclose = () => {
          reject(new Error('Unreliable channel closed during startup.'));
        }
      });
    });
  })
}


export class NetworkClient {
  constructor() {
    this.packetPeer = new lk.PacketPeer();
  }

  connect(serverWsUrl: string): Bluebird<void> {
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
    }).catch(() => this.handleDisconnect());
  }

  isConnected = false;
  // Carries our assigned playerId
  onConnected = new SyncEvent<lk.PlayerId>();
  onDisconnected = new VoidSyncEvent();

  /*
   * All PacketTypes you will send or receive must be registered for serialisation / deserialisation
   */
  registerPacketType<T extends Serializable>(
    ctor: {new(...args: any[]):T},
    uniquePacketTypeName: string
  ): void {
    return this.packetPeer.registerPacketType(ctor, uniquePacketTypeName);
  }

  registerPacketHandler<T extends Serializable>(
    ctor: {new(...args: any[]):T},
    handler: (t: T, sequenceNumber: number) => void
  ): void {
    return this.packetPeer.registerPacketHandler(ctor, handler);
  }

  sendPacket(packet: Serializable, onAck?: () => void) {
    return this.packetPeer.sendPacket(packet, onAck);
  }

  private rtcConnection?: ClientRTCConnection;
  private packetPeer = new lk.PacketPeer();

  private handleDisconnect() {
    if(this.rtcConnection) {
      this.rtcConnection.close();
    }
    this.rtcConnection = undefined;
    this.isConnected = false;
    this.onDisconnected.post();
  }
}