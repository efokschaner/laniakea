import * as http from 'http';

const getBasicAuthCreds = require('basic-auth');

import * as Bluebird from 'bluebird';
import { SyncEvent } from 'ts-events';
import { RTCPeerConnection } from 'wrtc';
import { server as WebSocketServer, request as WebSocketRequest } from 'websocket';

import * as lk from 'laniakea-shared';

function logError(...args: any[]) {
  return console.error.apply(console, args);
}

export interface AuthSuccessResult {
  playerId: number;
}

function isAuthSuccessResult(x: any): x is AuthSuccessResult {
  return x && x.playerId !== undefined;
}

export interface AuthFailureResult {
  httpStatus: number;
  reason: string;
  extraHeaders: Map<string, string>;
}

function isAuthFailureResult(x: any): x is AuthFailureResult {
  return x && x.playerId == undefined;
}

export type AuthResult = AuthSuccessResult | AuthFailureResult;

// An AuthCallback should authenticate the player making the incoming
// WebSocket connection (by inspecting the http.ClientRequest).
// If the WebSocket authenticates, the negotiation of webRTC can begin.
export type AuthCallback = (req: http.ClientRequest) => AuthResult;

// For demo purposes only, do not use in production
export function INSECURE_AuthCallback(httpRequest: http.ClientRequest) {
  var creds = getBasicAuthCreds(httpRequest);
  // Browsers will first try without auth and then actually send creds once they see the 401
  if(!creds) {
    return {
      httpStatus: 401,
      reason: 'Unauthorized',
      extraHeaders: new Map([['WWW-Authenticate', 'Basic realm="Laniakea"']]),
    };
  }
  return { playerId: creds.name };
}

export type PlayerId = number;

// Handles authentication + establishment of the webRTC conn via WebSockets
class RTCServer {
  public readonly onConnection = new SyncEvent<{playerId: PlayerId, conn: lk.RTCPeerConnectionWithOpenDataChannels}>();
  private connections = new Map<PlayerId, lk.RTCPeerConnectionWithOpenDataChannels>();
  private httpServer: http.Server;
  private wsServer: WebSocketServer;
  constructor(private authenticatePlayer: AuthCallback) {
    this.httpServer = http.createServer(function(request, response) {
      response.writeHead(404);
      response.end();
    });
    this.wsServer = new WebSocketServer({
      httpServer: this.httpServer,
      autoAcceptConnections: false
    });
    this.wsServer.on('request', this._handleWebsocketUpgradeRequest.bind(this));
  }
  listen(serverPort: number) {
    return new Bluebird((resolve, reject) => {
      this.httpServer.listen(serverPort, () => {
        let address = this.httpServer.address();
        console.log('HTTP server is listening on ', address);
        resolve(address);
      });
      this.httpServer.on('error', (err: any) => {
        reject(err);
      });
    });
  }
  close() {
    return new Bluebird((resolve, reject) => {
      this.wsServer.on('close', (connection, closeReason, description) => {
        if(this.wsServer.connections.length === 0) {
          resolve();
        }
      });
      this.wsServer.shutDown();
      setTimeout(function() {
        reject(new Error('Could not shut down all ws connections in time.'));
      }, 500);
    }).finally(() => {
      this.httpServer.close();
    });
  }
  private _originIsAllowed(origin: string) {
    // TODO: Figure out if origin restrictions are needed
    return true;
  }
  private _handleNewConnection(playerId: PlayerId, conn: lk.RTCPeerConnectionWithOpenDataChannels) {
    let maybeExistingConn = this.connections.get(playerId);
    if(maybeExistingConn !== undefined) {
      maybeExistingConn.close();
    }
    conn.onClose.attach(() => {
      this.connections.delete(playerId);
    });
    this.connections.set(playerId, conn);
    this.onConnection.post({playerId, conn});
  }
  private _handleWebsocketUpgradeRequest(request: WebSocketRequest) {
    if (!this._originIsAllowed(request.origin)) {
      request.reject();
      console.log('Connection from origin ' + request.origin + ' rejected.');
      return;
    }
    console.log('Connection from origin ' + request.origin + ' allowed.');
    let authResult = this.authenticatePlayer(request.httpRequest);
    if (isAuthFailureResult(authResult)) {
      let headerObj: any = {};
      if(authResult.extraHeaders) {
        authResult.extraHeaders.forEach((headerValue, headerName) => {
          headerObj[headerName] = headerValue;
        });
      }
      request.reject(authResult.httpStatus, authResult.reason, headerObj);
      return;
    } else if (!isAuthSuccessResult(authResult)) {
      console.log('Authentication error.');
      request.reject(401, 'Unauthorised');
      return;
    }
    let successfulAuthResult: AuthSuccessResult = authResult;
    console.log('Player with id ' + successfulAuthResult.playerId + ' authed successfully.');
    let wsConnection = request.accept(undefined, request.origin);

    let peerConnection = new RTCPeerConnection(undefined as any as RTCConfiguration);
    wsConnection.on('message', function(message) {
      if (message.type === 'utf8') {
        let messageObj = JSON.parse(message.utf8Data!);
        if (messageObj.desc) {
          let desc = messageObj.desc;
          // if we get an offer, we need to reply with an answer
          if (desc.type == "offer") {
            peerConnection.setRemoteDescription(desc).then(function () {
              return peerConnection.createAnswer();
            })
            .then(function (answer) {
              return peerConnection.setLocalDescription(answer);
            })
            .then(function () {
              wsConnection.sendUTF(JSON.stringify({ "desc": peerConnection.localDescription }));
            })
            .catch(logError);
          } else {
            peerConnection.setRemoteDescription(desc).catch(logError);
          }
        } else if (messageObj.candidate) {
          peerConnection.addIceCandidate(messageObj.candidate).catch(logError);
        }
      } else if (message.type === 'binary') {
        logError('Ignoring Binary Message: ', message.binaryData!);
      }
    });
    wsConnection.on('close', function(reasonCode, description) {
      console.log('WebSocket client ' + wsConnection.remoteAddress + ' disconnected.');
    });
    // send any ice candidates to the other peer
    peerConnection.onicecandidate = function (evt) {
      wsConnection.sendUTF(JSON.stringify({ "candidate": evt.candidate }));
    };
    let reliableChannel: lk.BufferedRTCDataChannel;
    let unreliableChannel: lk.BufferedRTCDataChannel;
    function isOpen(chan: lk.BufferedRTCDataChannel) {
      return chan && chan.readyState == 'open';
    }
    let thisConnHandled = false;
    let onDataChannelOpen = () => {
      if(!thisConnHandled && isOpen(reliableChannel) && isOpen(unreliableChannel)) {
        thisConnHandled = true;
        wsConnection.close();
        let newConn = new lk.RTCPeerConnectionWithOpenDataChannels(
          peerConnection,
          reliableChannel,
          unreliableChannel
        );
        this._handleNewConnection(successfulAuthResult.playerId, newConn);
      }
    }
    peerConnection.ondatachannel = function (evt: RTCDataChannelEvent) {
      let dataChannel = evt.channel;
      console.log('peerConnection.ondatachannel ' + dataChannel.label);
      // Because we're waiting for two channels to open,
      // it's possible for messages to arrive on one before
      // the other is complete, so listeners wont be ready.
      // To compensate, we buffer both channels and let the
      // listeners call flushAndStopBuffering when they're ready
      if(dataChannel.label === 'reliable') {
        reliableChannel = lk.bufferRTCDataChannel(dataChannel);
        reliableChannel.binaryType = 'arraybuffer';
        reliableChannel.onopen = function() {
          onDataChannelOpen();
        }
      } else if(dataChannel.label === 'unreliable') {
        unreliableChannel = lk.bufferRTCDataChannel(dataChannel);
        unreliableChannel.binaryType = 'arraybuffer';
        dataChannel.onopen = function() {
          onDataChannelOpen();
        }
      } else {
        logError('Unexpected channel opened', dataChannel);
      }
    };
  }
}

export class NetworkServer {
  private rtcServer: RTCServer;
  private connections = new Map<PlayerId, lk.PacketConnection>();

  constructor(authenticatePlayer: AuthCallback) {
    this.rtcServer = new RTCServer(authenticatePlayer);
    this.rtcServer.onConnection.attach(({playerId, conn}) => {
      let packetConn = new lk.PacketConnection(conn);
      this.connections.set(playerId, packetConn);
      conn.onClose.attach(() => {
        this.connections.delete(playerId);
      });
      this.onConnection.post(playerId);
      conn.flushAndStopBuffering();
    });
  }
  listen(serverPort: number) {
    return this.rtcServer.listen(serverPort);
  }
  close() {
    this.connections.clear();
    return this.rtcServer.close();
  }

  onConnection = new SyncEvent<PlayerId>();

  // TODO Don't expose these, make a message protocol on top of packets
  onPacketReceived = new SyncEvent<{playerId: number, payload: Uint8Array}>();
  sendPacket(playerId: PlayerId, payload: Uint8Array, onAck?: () => void) {
    let maybeConn = this.connections.get(playerId);
    if(maybeConn !== undefined) {
      maybeConn.sendPacket(payload, onAck);
    }
  }
}