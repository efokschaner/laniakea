import { SyncEvent } from 'ts-events';
import { ClassRegistry } from '../reflection';
import { Serializable } from '../serialization';
import { AckingPeer } from './acking-peer';
import { MessagePeer, OutgoingMessage } from './message-peer';
import { MessageRouter } from './message-router';
import { LikeRTCDataChannelOrWebSocket } from './socket-abstraction';

/*
 * This class does the recoupling of different networking subsystems,
 * to remove boilerplate from client and server.
 * Manages the network state that persists across connections.
 */
export class NetworkPeer {
  constructor(
    private channel: LikeRTCDataChannelOrWebSocket,
    private messageClassRegistry: ClassRegistry,
    private messageRouter: MessageRouter) {
    channel.onerror = (error) => {
      console.error('channel error:', error);
    };
    channel.onclose = () => {
      this.close();
    };
    this.messagePeer.onMessageReceived.attach((m) => {
      this.messageRouter.routeMessage(m);
    });
  }

  public onClose = new SyncEvent<this>();
  private _isClosing = false;

  public close() {
    if (!this._isClosing) {
      this._isClosing = true;
      this.channel.close();
      this.onClose.post(this);
    }
  }

  /**
   * Places messages in to the outbound queue. Actual network send is done by flushMessagesToNetwork.
   * Messages are unordered, prioritized individually,
   * and can be given a TTL / marked expired to limit reliability.
   */
  public sendMessage(message: Serializable, onAck?: () => void) : OutgoingMessage {
    return this.messagePeer.sendMessage(message, onAck);
  }

  public flushMessagesToNetwork() {
    this.messagePeer.flushMessagesToNetwork();
  }

  private ackingPeer = new AckingPeer(this.channel);
  private messagePeer = new MessagePeer(this.ackingPeer, this.messageClassRegistry);
}
