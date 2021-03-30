import { ClassRegistry, Serializable } from '@laniakea/utils';
import { SyncEvent } from 'ts-events';
import { AckingPeer } from './acking-peer';
import { MessagePeer, OutboundMessage } from './message-peer';
import { MessageRouter } from './message-router';
import { LikeRTCDataChannelOrWebSocket } from './socket-abstraction';

/*
 * This class does the recoupling of different networking subsystems,
 * to remove boilerplate from client and server.
 */
export class NetworkPeer {
  public constructor(
    private channel: LikeRTCDataChannelOrWebSocket,
    private classRegistry: ClassRegistry<Serializable>,
    private messageRouter: MessageRouter
  ) {
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

  public close(): void {
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
  public sendMessage(
    message: Serializable,
    onAck?: () => void
  ): OutboundMessage {
    return this.messagePeer.sendMessage(message, onAck);
  }

  public flushMessagesToNetwork(): void {
    this.messagePeer.flushMessagesToNetwork();
  }

  public getMtuForMessage(): number {
    return this.ackingPeer.getMtuForPayload();
  }

  private ackingPeer = new AckingPeer(this.channel);
  private messagePeer = new MessagePeer(this.ackingPeer, this.classRegistry);
}
