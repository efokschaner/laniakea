import {
  MessageRouter,
  NetworkPeer,
  OutboundMessage,
  PlayerId,
  registerBuiltinMessages,
  RTCPeerConnectionAndDataChannel,
  S2C_BuiltinHandshakeMessage,
} from '@laniakea/network-peer';
import { ClassRegistry, Serializable } from '@laniakea/utils';
import { SyncEvent, VoidSyncEvent } from 'ts-events';

function logError(message: string) {
  return console.error(message);
}

interface NetworkPeerAndPlayerId {
  networkPeer: NetworkPeer;
  assignedPlayerId: PlayerId;
}

export class NetworkClient {
  constructor(private classRegistry: ClassRegistry) {
    registerBuiltinMessages(this.classRegistry);
    this.registerMessageHandler(S2C_BuiltinHandshakeMessage, (message) => {
      if (this.handshakeFulfillment !== undefined) {
        this.classRegistry.setTypeIdToShortTypeIdMapping(message.classRegistryDictionary);
        this.isConnected = true;
        this.handshakeFulfillment.resolve();
        this.onConnected.post(this.assignedPlayerId!);
        this.handshakeFulfillment = undefined;
      } else {
        console.error('Unexpected S2C_BuiltinHandshakeMessage');
      }
    });
  }

  public connect(serverWsUrl: string): Promise<void> {
    let handshakePromise = new Promise<void>((resolve, reject) => {
      this.handshakeFulfillment = {resolve, reject};
    });
    return this.connectToRTCServer(serverWsUrl).then((connectResult) => {
      this.networkPeer = connectResult.networkPeer;
      this.assignedPlayerId = connectResult.assignedPlayerId;
      this.networkPeer.onClose.attach(() => this.handleDisconnect());
      return handshakePromise;
    }).catch((e) => {
      this.handleDisconnect();
      throw e;
    });
  }

  public close() {
    if (this.networkPeer !== undefined) {
      this.networkPeer.close();
    }
  }

  public isConnected = false;
  // Carries our assigned playerId
  public onConnected = new SyncEvent<PlayerId>();
  public onDisconnected = new VoidSyncEvent();

  /*
   * All message types you will send or receive must be registered for serialisation / deserialisation
   */
  public registerMessageType<T extends Serializable>(
    ctor: new(...args: any[]) => T,
    uniqueMessageTypeName: string,
  ): void {
    this.classRegistry.registerClass(ctor, uniqueMessageTypeName);
  }

  public registerMessageHandler<T extends Serializable>(
    ctor: new(...args: any[]) => T,
    handler: (t: T) => void): void {
    this.messageRouter.registerHandler(ctor, handler);
  }

  /**
   * Places messages in to the outbound queue. Actual network send is done by flushMessagesToNetwork.
   * Messages are unordered, prioritized individually,
   * and can be given a TTL / marked expired to limit reliability.
   */
  public sendMessage(message: Serializable, onAck?: () => void): OutboundMessage|undefined {
    // Don't send messages before the handshake is complete
    if (this.handshakeFulfillment === undefined && this.networkPeer !== undefined) {
      return this.networkPeer.sendMessage(message, onAck);
    }
    return undefined;
  }
  /**
   * Sends messages across the network
   */
  public flushMessagesToNetwork() {
    if (this.networkPeer !== undefined) {
      this.networkPeer.flushMessagesToNetwork();
    }
  }

  private messageRouter = new MessageRouter();
  private networkPeer?: NetworkPeer;
  private assignedPlayerId?: PlayerId;
  private handshakeFulfillment?: { resolve: (value?: void | PromiseLike<void>) => void, reject: (reason?: any) => void };

  private handleDisconnect() {
    if (this.networkPeer) {
      this.networkPeer.close();
    }
    this.networkPeer = undefined;
    if (this.handshakeFulfillment) {
      this.handshakeFulfillment.reject(new Error('Disconnected'));
    }
    this.handshakeFulfillment = undefined;
    let wasConnected = this.isConnected;
    this.isConnected = false;
    if (wasConnected) {
      this.onDisconnected.post();
    }
  }
  private connectToRTCServer(serverWsUrl: string): Promise<NetworkPeerAndPlayerId> {
    let websocketForCleanup: WebSocket | undefined;
    let assignedPlayerId: PlayerId | undefined;
    return new Promise<{ websocket: WebSocket, peerConnection: RTCPeerConnection }>((resolve, reject) => {
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
        resolve({ websocket, peerConnection });
      };
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
      return new Promise<NetworkPeerAndPlayerId>((resolve, reject) => {
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
        let dataChannel = peerConnection.createDataChannel('laniakea-unreliable', {negotiated: true, id: 0});
        dataChannel.binaryType = 'arraybuffer';
        let peerConnectionAndDataChannel = new RTCPeerConnectionAndDataChannel(peerConnection, dataChannel);
        let networkPeer = new NetworkPeer(peerConnectionAndDataChannel, this.classRegistry, this.messageRouter);
        dataChannel.onopen = () => {
          if (assignedPlayerId === undefined) {
            // This should never happen as playerId should be transmitted before rtc stuff.
            reject(new Error('Expected to have assignedPlayerId before connection was fully open.'));
          } else {
            resolve({
              assignedPlayerId,
              networkPeer,
            });
          }
        };
        networkPeer.onClose.attach(() => { reject(new Error('networkPeer closed during startup.')); } );
      });
    }).finally(() => {
      if (websocketForCleanup) {
        websocketForCleanup.close();
      }
    });
  }
}
