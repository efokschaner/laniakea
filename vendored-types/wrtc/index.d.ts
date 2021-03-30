// Vendored definitions for wrtc as it has no typings
declare let GlobalRTCPeerConnection: RTCPeerConnection;

declare module 'wrtc' {
  let RTCPeerConnection: {
    prototype: typeof GlobalRTCPeerConnection;
    new (configuration: RTCConfiguration): typeof GlobalRTCPeerConnection;
  };
}
