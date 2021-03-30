import { Serializable } from '@laniakea/utils';

/**
 * Provides routing of different Message types to different callbacks
 */
export class MessageRouter {
  /*
   * Add handlers for any message type you wish to handle
   */
  public registerHandler<T extends Serializable>(
    ctor: new (...args: any[]) => T,
    handler: (t: T) => void
  ): void {
    this.callbacks.set(ctor, handler);
  }

  public routeMessage(message: Serializable): void {
    let maybeCb = this.callbacks.get(message.constructor);
    if (maybeCb === undefined) {
      console.error(
        `No handler registered for message type: ${message.constructor.name}`
      );
      return;
    }
    maybeCb(message);
  }

  // Allow the use of Function. It's truly the type of constructors in TS...
  // eslint-disable-next-line @typescript-eslint/ban-types
  private callbacks = new Map<Function, (m: any) => void>();
}
