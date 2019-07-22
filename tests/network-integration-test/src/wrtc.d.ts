// Vendored definitions for wrtc as it has no typings
declare var GlobalRTCPeerConnection: RTCPeerConnection;

declare module 'wrtc' {
  var RTCPeerConnection: {
    prototype: typeof GlobalRTCPeerConnection;
    new (configuration: RTCConfiguration): typeof GlobalRTCPeerConnection
  };
}