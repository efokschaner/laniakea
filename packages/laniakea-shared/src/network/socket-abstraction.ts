/**
 * An interface that is satisfied by both WebSocket and RTCDataChannel
 */
export interface LikeRTCDataChannelOrWebSocket {
  close(): void;
  onclose: ((e: any) => any) | null;
  onerror: ((e: ErrorEvent|RTCErrorEvent) => any) | null;
  onmessage: ((ev: MessageEvent) => any) | null;
  send(data: ArrayBuffer): void;
}

/**
 * Bundles peer connection with datachannel so that we close both when we close the datachannel
 */
export class RTCPeerConnectionAndDataChannel implements LikeRTCDataChannelOrWebSocket {
  constructor(private peerConnection: RTCPeerConnection, private dataChannel: RTCDataChannel) {
  }
  public close(): void {
    this.dataChannel.close();
    this.peerConnection.close();
    delete this.dataChannel;
    delete this.peerConnection;
  }
  set onclose(cb: ((e: any) => any) | null) {
    this.dataChannel.onclose = cb;
  }
  set onerror(cb: ((e: ErrorEvent|RTCErrorEvent) => any) | null) {
    this.dataChannel.onerror = cb;
  }
  set onmessage(cb: ((ev: MessageEvent) => any) | null) {
    this.dataChannel.onmessage = cb;
  }
  public send(data: ArrayBuffer): void {
    this.dataChannel.send(data);
  }
}
