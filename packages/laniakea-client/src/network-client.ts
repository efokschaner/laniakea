import * as Bluebird from 'bluebird';
import * as lk from 'laniakea-shared';
import { NetworkPeer, Serializable } from 'laniakea-shared';
import { SyncEvent, VoidSyncEvent } from 'ts-events';

function logError(message: string) {
  return console.error(message);
}

interface NetworkPeerAndPlayerId {
  networkPeer: lk.NetworkPeer;
  assignedPlayerId: lk.PlayerId;
}

export class NetworkClient {
  constructor() {
  }

  public connect(serverWsUrl: string): Bluebird<void> {
    return this.connectToRTCServer(serverWsUrl).then((connectResult) => {
      this.networkPeer = connectResult.networkPeer;
      this.networkPeer.onClose.attach(() => this.handleDisconnect());
      this.isConnected = true;
      this.onConnected.post(connectResult.assignedPlayerId);
    }).tapCatch(() => this.handleDisconnect());
  }

  public close() {
    if (this.networkPeer !== undefined) {
      this.networkPeer.close();
    }
  }

  public isConnected = false;
  // Carries our assigned playerId
  public onConnected = new SyncEvent<lk.PlayerId>();
  public onDisconnected = new VoidSyncEvent();

  /*
   * All message types you will send or receive must be registered for serialisation / deserialisation
   */
  public registerMessageType<T extends Serializable>(
    ctor: new(...args: any[]) => T,
    uniqueMessageTypeName: string,
  ): void {
    this.messageClassRegistry.registerClass(ctor, uniqueMessageTypeName);
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
  public sendMessage(message: Serializable, onAck?: () => void) : lk.OutgoingMessage|undefined {
    if (this.networkPeer !== undefined) {
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

  private messageClassRegistry = new lk.ClassRegistry();
  private messageRouter = new lk.MessageRouter();
  private networkPeer?: lk.NetworkPeer;

  private handleDisconnect() {
    if (this.networkPeer) {
      this.networkPeer.close();
    }
    this.networkPeer = undefined;
    this.isConnected = false;
    this.onDisconnected.post();
  }
  private connectToRTCServer(serverWsUrl: string): Bluebird<NetworkPeerAndPlayerId> {
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
      return new Bluebird<NetworkPeerAndPlayerId>((resolve, reject) => {
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
        let peerConnectionAndDataChannel = new lk.RTCPeerConnectionAndDataChannel(peerConnection, dataChannel);
        let networkPeer = new NetworkPeer(peerConnectionAndDataChannel, this.messageClassRegistry, this.messageRouter);
        dataChannel.onopen = () => {
          if (assignedPlayerId === undefined) {
            // This should never happen as playerId should be transmitted before rtc stuff.
            reject(new Error('Expected to have assignedPlayerId before connection was fully open.'));
          } else {
            resolve({
              assignedPlayerId,
              networkPeer
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
