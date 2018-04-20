import * as http from 'http';

// tslint:disable-next-line:no-var-requires
const getBasicAuthCreds = require('basic-auth');

import * as Bluebird from 'bluebird';
import { SyncEvent } from 'ts-events';
import { request as WebSocketRequest, server as WebSocketServer } from 'websocket';
import { RTCPeerConnection } from 'wrtc';

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
  return x && x.playerId === undefined;
}

export type AuthResult = AuthSuccessResult | AuthFailureResult;

// An AuthCallback should authenticate the player making the incoming
// WebSocket connection (by inspecting the http.IncomingMessage).
// If the WebSocket authenticates, the negotiation of webRTC can begin.
export type AuthCallback = (req: http.IncomingMessage) => AuthResult;

// For demo purposes only, do not use in production
export function INSECURE_AuthCallback(httpRequest: http.IncomingMessage): AuthResult {
  let creds = getBasicAuthCreds(httpRequest);
  // Browsers will first try without auth and then actually send creds once they see the 401
  if (!creds) {
    return {
      extraHeaders: new Map([['WWW-Authenticate', 'Basic realm="Laniakea"']]),
      httpStatus: 401,
      reason: 'Unauthorized',
    };
  }
  return { playerId: parseInt(creds.name, 10) };
}

// Handles authentication + establishment of the webRTC conn via WebSockets
class RTCServer {
  public readonly onConnection = new SyncEvent<{playerId: lk.PlayerId, conn: lk.RTCPeerConnectionWithOpenDataChannels}>();
  private connections = new Map<lk.PlayerId, lk.RTCPeerConnectionWithOpenDataChannels>();
  private httpServer: http.Server;
  private wsServer: WebSocketServer;
  constructor(private authenticatePlayer: AuthCallback) {
    this.httpServer = http.createServer((request, response) => {
      response.writeHead(404);
      response.end();
    });
    this.wsServer = new WebSocketServer({
      autoAcceptConnections: false,
      httpServer: this.httpServer,
    });
    this.wsServer.on('request', this._handleWebsocketUpgradeRequest.bind(this));
  }
  public listen(serverPort: number) {
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
  public close() {
    return new Bluebird((resolve, reject) => {
      this.wsServer.on('close', (connection, closeReason, description) => {
        if (this.wsServer.connections.length === 0) {
          resolve();
        }
      });
      this.wsServer.shutDown();
      setTimeout(() => {
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
  private _handleNewConnection(playerId: lk.PlayerId, conn: lk.RTCPeerConnectionWithOpenDataChannels) {
    let maybeExistingConn = this.connections.get(playerId);
    if (maybeExistingConn !== undefined) {
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
      if (authResult.extraHeaders) {
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
    wsConnection.sendUTF(JSON.stringify({playerIdAssignment: successfulAuthResult.playerId}));
    let peerConnection = new RTCPeerConnection(undefined as any as RTCConfiguration);
    wsConnection.on('message', (message) => {
      if (message.type === 'utf8') {
        let messageObj = JSON.parse(message.utf8Data!);
        if (messageObj.desc) {
          let desc = messageObj.desc;
          // if we get an offer, we need to reply with an answer
          if (desc.type === 'offer') {
            peerConnection.setRemoteDescription(desc).then(() => {
              return peerConnection.createAnswer();
            })
            .then((answer) => {
              return peerConnection.setLocalDescription(answer);
            })
            .then(() => {
              wsConnection.sendUTF(JSON.stringify({ desc: peerConnection.localDescription }));
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
    wsConnection.on('close', (reasonCode, description) => {
      console.log('WebSocket client ' + wsConnection.remoteAddress + ' disconnected.');
    });
    // send any ice candidates to the other peer
    peerConnection.onicecandidate = (evt) => {
      wsConnection.sendUTF(JSON.stringify({ candidate: evt.candidate }));
    };
    let reliableChannel: lk.BufferedRTCDataChannel;
    let unreliableChannel: lk.BufferedRTCDataChannel;
    function isOpen(chan: lk.BufferedRTCDataChannel) {
      return chan && chan.readyState === 'open';
    }
    let thisConnHandled = false;
    let onDataChannelOpen = () => {
      if (!thisConnHandled && isOpen(reliableChannel) && isOpen(unreliableChannel)) {
        thisConnHandled = true;
        wsConnection.close();
        let newConn = new lk.RTCPeerConnectionWithOpenDataChannels(
          peerConnection,
          reliableChannel,
          unreliableChannel,
        );
        this._handleNewConnection(successfulAuthResult.playerId, newConn);
      }
    };
    peerConnection.ondatachannel = (evt: RTCDataChannelEvent) => {
      let dataChannel = evt.channel;
      console.log('peerConnection.ondatachannel ' + dataChannel.label);
      // Because we're waiting for two channels to open,
      // it's possible for messages to arrive on one before
      // the other is complete, so listeners wont be ready.
      // To compensate, we buffer both channels and let the
      // listeners call flushAndStopBuffering when they're ready
      if (dataChannel.label === 'reliable') {
        reliableChannel = lk.bufferRTCDataChannel(dataChannel);
        reliableChannel.binaryType = 'arraybuffer';
        reliableChannel.onopen = () => {
          onDataChannelOpen();
        };
      } else if (dataChannel.label === 'unreliable') {
        unreliableChannel = lk.bufferRTCDataChannel(dataChannel);
        unreliableChannel.binaryType = 'arraybuffer';
        dataChannel.onopen = () => {
          onDataChannelOpen();
        };
      } else {
        logError('Unexpected channel opened', dataChannel);
      }
    };
  }
}

export class NetworkServer {
  private rtcServer: RTCServer;
  private connections = new Map<lk.PlayerId, lk.PacketPeer>();

  constructor(authenticatePlayer: AuthCallback) {
    this.rtcServer = new RTCServer(authenticatePlayer);
    this.rtcServer.onConnection.attach(({playerId, conn}) => {
      let packetPeer = new lk.PacketPeer();
      for (let ctorAndName of this.registeredPacketTypes) {
        packetPeer.registerPacketType(ctorAndName[0], ctorAndName[1]);
      }
      for (let ctorAndHandler of this.registeredPacketHandlers) {
        let handlerWithPlayerIdParamBound = (packet: lk.Serializable, sequenceNumber: number) => ctorAndHandler[1](playerId, packet, sequenceNumber);
        packetPeer.registerPacketHandler(ctorAndHandler[0], handlerWithPlayerIdParamBound);
      }
      packetPeer.attachToConnection(conn);
      this.connections.set(playerId, packetPeer);
      conn.onClose.attach(() => {
        this.connections.delete(playerId);
      });
      this.onConnection.post(playerId);
      conn.flushAndStopBuffering();
    });
  }
  public listen(serverPort: number) {
    return this.rtcServer.listen(serverPort);
  }
  public close() {
    this.connections.clear();
    return this.rtcServer.close();
  }

  public onConnection = new SyncEvent<lk.PlayerId>();

  /*
   * All PacketTypes you will send or receive must be registered for serialisation / deserialisation
   */
  public registerPacketType<T extends lk.Serializable>(
    ctor: {new(...args: any[]): T},
    uniquePacketTypeName: string,
  ): void {
    this.registeredPacketTypes.push([ctor, uniquePacketTypeName]);
  }

  public registerPacketHandler<T extends lk.Serializable>(
    ctor: {new(...args: any[]): T},
    handler: (playerId: lk.PlayerId, packet: T, sequenceNumber: number) => void,
  ): void {
    this.registeredPacketHandlers.push([
      ctor as {new(...args: any[]): lk.Serializable},
      handler as (playerId: lk.PlayerId, packet: lk.Serializable, sequenceNumber: number) => void]);
  }

  public sendPacket(playerId: lk.PlayerId, packet: lk.Serializable, onAck?: () => void) {
    let maybeConn = this.connections.get(playerId);
    if (maybeConn !== undefined) {
      maybeConn.sendPacket(packet, onAck);
    }
  }

  private registeredPacketTypes: Array<[{new(...args: any[]): lk.Serializable}, string]> = [];
  private registeredPacketHandlers: Array<[
    {new(...args: any[]): lk.Serializable},
    (playerId: lk.PlayerId, packet: lk.Serializable, sequenceNumber: number) => void]> = [];
}
