import * as http from 'http';
import { AddressInfo } from 'net';
import {
  LikeRTCDataChannelOrWebSocket,
  MessageRouter,
  NetworkPeer,
  OutboundMessage,
  PlayerId,
  registerBuiltinMessages,
  RTCPeerConnectionAndDataChannel,
  S2C_BuiltinHandshakeMessage,
} from '@laniakea/network-peer';
import { ClassRegistry, Serializable } from '@laniakea/utils';
import { SyncEvent } from 'ts-events';
import {
  request as WebSocketRequest,
  server as WebSocketServer,
} from 'websocket';
import { RTCPeerConnection } from 'wrtc';

import getBasicAuthCreds = require('basic-auth');

function logError(message: unknown, ...optionalParams: unknown[]) {
  return console.error.apply(console, [message, ...optionalParams]);
}

export interface AuthSuccessResult {
  playerId: PlayerId;
}

export interface AuthFailureResult {
  httpStatus: number;
  reason: string;
  extraHeaders: Map<string, string>;
  playerId?: never;
}

export type AuthResult = AuthSuccessResult | AuthFailureResult;

function isAuthSuccessResult(x: AuthResult): x is AuthSuccessResult {
  return x.playerId !== undefined;
}

function isAuthFailureResult(x: AuthResult): x is AuthFailureResult {
  return x.playerId === undefined;
}

/**
 * An AuthCallback should authenticate the player making the incoming
 * WebSocket connection (by inspecting the http.IncomingMessage).
 * If the WebSocket authenticates, the negotiation of webRTC can begin.
 */
export type AuthCallback = (req: http.IncomingMessage) => AuthResult;

/**
 * For demo purposes only, do not use in production
 */
export function INSECURE_AuthCallback(
  httpRequest: http.IncomingMessage
): AuthResult {
  let creds = getBasicAuthCreds(httpRequest);
  // Browsers will first try without auth and then actually send creds once they see the 401
  if (!creds) {
    return {
      extraHeaders: new Map([['WWW-Authenticate', 'Basic realm="Laniakea"']]),
      httpStatus: 401,
      reason: 'Unauthorized',
    };
  }
  return { playerId: parseInt(creds.name, 10) as PlayerId };
}

export interface WebrtcPeerConnectionPortRange {
  min?: number; // defaults to 0
  max?: number; // defaults to 65535
}

export interface ListenOptions {
  signalingWebsocketServerPort: number;
  webrtcPeerConnectionPortRange?: WebrtcPeerConnectionPortRange;
}

/**
 * Handles authentication + establishment of the webRTC conn via WebSockets
 */
class RTCServer {
  public readonly onConnection = new SyncEvent<{
    playerId: PlayerId;
    networkPeer: NetworkPeer;
  }>();
  private connections = new Map<PlayerId, NetworkPeer>();
  private httpServer: http.Server;
  private wsServer: WebSocketServer;
  public constructor(
    private authenticatePlayer: AuthCallback,
    // The purpose of this callback is to ensure that message handlers are attached to the opening channel asap before incoming messages arrive
    private constructNetworkPeerFromChannel: (
      playerId: PlayerId,
      l: LikeRTCDataChannelOrWebSocket
    ) => NetworkPeer
  ) {
    this.httpServer = http.createServer((_request, response) => {
      response.writeHead(404);
      response.end();
    });
    this.wsServer = new WebSocketServer({
      autoAcceptConnections: false,
      httpServer: this.httpServer,
    });
    this.wsServer.on('request', this._handleWebsocketUpgradeRequest.bind(this));
  }
  public listen({
    signalingWebsocketServerPort,
    webrtcPeerConnectionPortRange,
  }: ListenOptions): Promise<AddressInfo> {
    this.webrtcPeerConnectionPortRange = webrtcPeerConnectionPortRange;
    return new Promise((resolve, reject) => {
      this.httpServer.listen(signalingWebsocketServerPort, () => {
        let address = this.httpServer.address();
        console.log('HTTP server is listening on ', address);
        resolve(address as AddressInfo); // Type assertion because only UNIX domain sockets have string address according to docs.
      });
      this.httpServer.on('error', (err: any) => {
        reject(err);
      });
    });
  }
  public close() {
    return new Promise<void>((resolve, reject) => {
      this.wsServer.on('close', (_connection, _closeReason, _description) => {
        if (this.wsServer.connections.length === 0) {
          resolve();
        }
      });
      this.wsServer.shutDown();
      if (this.wsServer.connections.length === 0) {
        resolve();
      } else {
        setTimeout(() => {
          reject(new Error('Could not shut down all ws connections in time.'));
        }, 500);
      }
    }).finally(() => {
      this.httpServer.close();
    });
  }
  private _originIsAllowed(_origin: string) {
    // TODO: Figure out if origin restrictions are needed
    return true;
  }
  private _handleNewConnection(playerId: PlayerId, networkPeer: NetworkPeer) {
    let maybeExistingConn = this.connections.get(playerId);
    if (maybeExistingConn !== undefined) {
      maybeExistingConn.close();
    }
    networkPeer.onClose.attach(() => {
      this.connections.delete(playerId);
    });
    this.connections.set(playerId, networkPeer);
    this.onConnection.post({ playerId, networkPeer });
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
      let headerObj: Record<string, string> = {};
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
    console.log(
      `Player with id ${successfulAuthResult.playerId} authed successfully.`
    );
    let wsConnection = request.accept(undefined, request.origin);
    wsConnection.sendUTF(
      JSON.stringify({ playerIdAssignment: successfulAuthResult.playerId })
    );
    // These are non-standard options that are supported by the node webrtc lib we're using
    let customPeerConfig = {
      portRange: this.webrtcPeerConnectionPortRange,
    };
    let peerConnection = new RTCPeerConnection(
      customPeerConfig as RTCConfiguration
    );
    wsConnection.on('message', (message) => {
      if (message.type === 'utf8') {
        let messageObj = JSON.parse(message.utf8Data!) as Record<
          string,
          unknown
        >;
        if (messageObj.desc) {
          let desc = messageObj.desc as RTCSessionDescriptionInit;
          // if we get an offer, we need to reply with an answer
          if (desc.type === 'offer') {
            peerConnection
              .setRemoteDescription(desc)
              .then(() => peerConnection.createAnswer())
              .then((answer) => peerConnection.setLocalDescription(answer))
              .then(() => {
                wsConnection.sendUTF(
                  JSON.stringify({ desc: peerConnection.localDescription })
                );
              })
              .catch(logError);
          } else {
            peerConnection.setRemoteDescription(desc).catch(logError);
          }
        } else if (messageObj.candidate) {
          peerConnection
            .addIceCandidate(messageObj.candidate as RTCIceCandidateInit)
            .catch(logError);
        }
      } else if (message.type === 'binary') {
        logError('Ignoring Binary Message: ', message.binaryData!);
      }
    });
    wsConnection.on('close', (reasonCode, description) => {
      console.log(
        `WebSocket client ${wsConnection.remoteAddress} disconnected. ${reasonCode} : ${description}`
      );
    });
    // send any ice candidates to the other peer
    peerConnection.onicecandidate = (evt) => {
      wsConnection.sendUTF(JSON.stringify({ candidate: evt.candidate }));
    };
    let dataChannel = peerConnection.createDataChannel('laniakea-unreliable', {
      negotiated: true,
      id: 0,
    });
    dataChannel.binaryType = 'arraybuffer';
    let peerConnectionAndDataChannel = new RTCPeerConnectionAndDataChannel(
      peerConnection,
      dataChannel
    );
    let networkPeer = this.constructNetworkPeerFromChannel(
      successfulAuthResult.playerId,
      peerConnectionAndDataChannel
    );
    dataChannel.onopen = () => {
      wsConnection.close();
      this._handleNewConnection(successfulAuthResult.playerId, networkPeer);
    };
  }
  private webrtcPeerConnectionPortRange?: WebrtcPeerConnectionPortRange;
}

export class NetworkServer {
  public constructor(
    private classRegistry: ClassRegistry<Serializable>,
    authenticatePlayer: AuthCallback
  ) {
    registerBuiltinMessages(this.classRegistry);
    this.rtcServer = new RTCServer(authenticatePlayer, (playerId, channel) => {
      let messageRouter = new MessageRouter();
      for (let ctorAndHandler of this.registeredMessageHandlers) {
        let handlerWithPlayerIdParamBound = (message: Serializable) =>
          ctorAndHandler[1](playerId, message);
        messageRouter.registerHandler(
          ctorAndHandler[0],
          handlerWithPlayerIdParamBound
        );
      }
      return new NetworkPeer(channel, this.classRegistry, messageRouter);
    });
    this.rtcServer.onConnection.attach(({ playerId, networkPeer }) => {
      networkPeer.onClose.attach(() => {
        this.handShakingConnections.delete(playerId);
        let wasConnected = this.connections.delete(playerId);
        if (wasConnected) {
          this.onDisconnect.post(playerId);
        }
      });
      this.handShakingConnections.set(playerId, networkPeer);
      let handshakeMessage = new S2C_BuiltinHandshakeMessage();
      handshakeMessage.classRegistryDictionary = this.classRegistry.getTypeIdToShortTypeIdMapping();
      networkPeer.sendMessage(handshakeMessage, () => {
        this.handShakingConnections.delete(playerId);
        this.connections.set(playerId, networkPeer);
        this.onConnection.post({ playerId, networkPeer });
      });
      networkPeer.flushMessagesToNetwork();
    });
  }

  public listen(options: ListenOptions): Promise<AddressInfo> {
    return this.rtcServer.listen(options);
  }
  public close(): Promise<void> {
    this.handShakingConnections.forEach((networkPeer) => networkPeer.close());
    this.handShakingConnections.clear();
    this.connections.forEach((networkPeer) => networkPeer.close());
    this.connections.clear();
    return this.rtcServer.close();
  }

  public readonly onConnection = new SyncEvent<{
    playerId: PlayerId;
    networkPeer: NetworkPeer;
  }>();
  public readonly onDisconnect = new SyncEvent<PlayerId>();

  /*
   * All PacketTypes you will send or receive must be registered for serialisation / deserialisation
   */
  public registerMessageType<T extends Serializable>(
    ctor: new (...args: any[]) => T,
    uniqueMessageTypeName: string
  ): void {
    this.classRegistry.registerClass(ctor, uniqueMessageTypeName);
  }

  public registerMessageHandler<T extends Serializable>(
    ctor: new (...args: any[]) => T,
    handler: (playerId: PlayerId, t: T) => void
  ): void {
    this.registeredMessageHandlers.push([
      ctor,
      handler as (playerId: PlayerId, packet: Serializable) => void,
    ]);
  }

  public sendMessage(
    playerId: PlayerId,
    message: Serializable,
    onAck?: () => void
  ): OutboundMessage {
    let maybeConn = this.connections.get(playerId);
    if (maybeConn !== undefined) {
      return maybeConn.sendMessage(message, onAck);
    }
    return new OutboundMessage(
      0,
      (undefined as any) as Serializable,
      undefined
    );
  }
  /**
   * Sends messages across the network
   * @param playerId optional id of player to only flush their messages
   */
  public flushMessagesToNetwork(playerId?: PlayerId): void {
    if (playerId !== undefined) {
      let maybeConnection = this.connections.get(playerId);
      if (maybeConnection !== undefined) {
        maybeConnection.flushMessagesToNetwork();
      }
    } else {
      this.connections.forEach((peer) => {
        peer.flushMessagesToNetwork();
      });
      this.handShakingConnections.forEach((peer) => {
        peer.flushMessagesToNetwork();
      });
    }
  }

  private rtcServer: RTCServer;
  private handShakingConnections = new Map<PlayerId, NetworkPeer>();
  private connections = new Map<PlayerId, NetworkPeer>();
  private registeredMessageHandlers: Array<
    [
      new (...args: any[]) => Serializable,
      (playerId: PlayerId, packet: Serializable) => void
    ]
  > = [];
}
