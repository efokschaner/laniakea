// tslint:disable-next-line:no-var-requires
// const present = require('present');

import { ClassRegistry, NetworkClient, periodicCallback, SequenceNumber } from 'laniakea-client';
import { NetworkServer, PlayerId, Serializable, SerializationStream } from 'laniakea-server';
import { w3cwebsocket } from 'websocket';
import { RTCPeerConnection } from 'wrtc';
import { createMetricsCollector, MetricsCollector } from './metrics-collection';

(global as any).WebSocket = w3cwebsocket;
(global as any).RTCPeerConnection = RTCPeerConnection;

function isBeingDebugged() {
  return typeof global.v8debug === 'object' || /--debug|--inspect/.test(process.execArgv.join(' '));
}

class TestMessage implements Serializable {
  public seq = 0;
  public data = new Uint8Array();
  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'seq');
    stream.serializeUint8Array(this, 'data');
  }
}

function onMessageReceivedByServer(_: PlayerId, __: TestMessage): void {
  // Noop
}

function onMessageReceivedByClient(_: TestMessage): void {
  // Noop
}

let clientPlayerId = 0 as PlayerId;

/**
 * Sends many messages with a short expiry and measures the overall
 * "delivery" latency of some changing data being communicated
 */
/*
function replicationStyleTest() {
  // Estimated parameters
  // 10,000 entities
  // 10 components per entity
  // Half components, of half entities changed per tick
  let numMessagesServerToClientPerTick = Math.round(100 * 10 * 0.5 * 0.5);
  // ttl for server to client
  let ttls = [1, 2, 4, 8, 16, 32];
  function getRandomTTL() {
    return ttls[Math.floor(Math.random()*ttls.length)];
  }
  // 1 -> 64 bytes per component (can't do 1 because of the uint8array TestMessage)
  let sizes = [2, 4, 8, 16, 32, 64];
  // subtract the 2 byte overhead of the uint8array size encoding
  sizes = sizes.map((x) => x-2);
  function getRandomSize() {
    return sizes[Math.floor(Math.random()*sizes.length)];
  }
  // 60 network ticks per second on server
  let serverFPS = 60;
  // 60 ticks per second on client
  let clientFPS = 60;
  // 64 bytes per client payload
  let clientSize = 64;
  // client packets last 1/2 a second
  let clientTTL = clientFPS / 2;

   let numAcksFromServer = 0;
  let numAcksFromClient = 0;
  let clientIter = 0;
  let serverIter = 0;
  // Ensure we send more messages than MAX_SEQUENCE_NUMBER_EXCLUSIVE in network code
  // Let's wrap around around
  let finishedSending = () => serverIter > ;

  let clientToServerHandle = periodicCallback(() => {
    if (!finished()) {
      let message = new TestMessage();
      message.seq = clientIter++;
      message.data = new Uint8Array(clientSize);
      let outgoingMessage = client.sendMessage(message, function() {
        numAcksFromServer += 1;
      });
      outgoingMessage.ttl = undefined;
    }
    client.flushMessagesToNetwork();
  }, 1000 / clientFPS, 'clientToServer');

  // Server generates messages at 1/2 the 60 net fps
  let serverAddMessagesThisFrame = true;
  let serverToClientHandle = periodicCallback(() => {
    if (!finished()) {
      if (serverAddMessagesThisFrame) {
        for (let i = 0; i < numMessagesServerToClientPerTick; ++i) {
          let message = new TestMessage();
          message.seq = serverIter++;
          message.data = new Uint8Array(getRandomSize());
          let outgoingMessage = server.sendMessage(clientPlayerId, message, function() {
            numAcksFromClient += 1;
          });
          outgoingMessage.ttl = undefined;
        }
      }
      serverAddMessagesThisFrame = !serverAddMessagesThisFrame;
    }
    server.flushMessagesToNetwork();
  }, 1000 / serverFPS, 'serverToClient');

  let timeoutId = setTimeout(function() {
    console.error('Test timed out');
    if (!isBeingDebugged()) {
      process.exit(1);
    }
  }, sendDurationMS * 1.5);

  let intervalId = setInterval(function() {
    metricsCollector.collectIntegrationTestMeasurements([
      {
        peerName: 'client',
        acksReceived: numAcksFromServer,
        messagesSent: clientIter,
      },
      {
        peerName: 'server',
        acksReceived: numAcksFromClient,
        messagesSent: serverIter,
      },
    ]);
    if (finished() && numAcksFromServer === clientIter && numAcksFromClient === serverIter) {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      console.log('All acks received.');
      clientToServerHandle.stop();
      serverToClientHandle.stop();
      client.close();
      server.close();
      // This is rather silly but theres a bug where the server peerconnection
      // prevents node.js shutting down, which I haven't figured out the root cause of
      let shutdownTimeout = setTimeout(function() {
        console.error('Shutdown timed out');
        if (!isBeingDebugged()) {
          process.exit(0);
        }
      }, 100);
      // Don't let the shutdown timeout itself keep node running.
      shutdownTimeout.unref();
    }
  }, 50);
}
*/

/**
 * Sends a steady stream of messages with no expiry and ensures they are all delivered
 */
function reliabilityTest(client: NetworkClient, server: NetworkServer, metricsCollector: MetricsCollector) {
  let numAcksFromServer = 0;
  let numAcksFromClient = 0;
  let clientIter = 0;
  let serverIter = 0;

  // Ensure we send more messages than MAX_SEQUENCE_NUMBER_EXCLUSIVE in network code
  let finishedSending = () => clientIter > 2 * SequenceNumber.MAX_SEQUENCE_NUMBER_EXCLUSIVE;

  let clientToServerHandle = periodicCallback(() => {
    if (!finishedSending()) {
      let message = new TestMessage();
      message.seq = clientIter++;
      message.data = new Uint8Array(0);
      let outgoingMessage = client.sendMessage(message, () => {
        numAcksFromServer += 1;
      })!;
      outgoingMessage.ttl = undefined;
    }
    client.flushMessagesToNetwork();
  }, 5, 'clientToServer');

  // Server generates messages at 1/2 the net fps
  let serverAddMessagesThisFrame = true;
  let serverToClientHandle = periodicCallback(() => {
    if (!finishedSending()) {
      if (serverAddMessagesThisFrame) {
        for (let i = 0; i < 50; ++i) {
          let message = new TestMessage();
          message.seq = serverIter++;
          message.data = new Uint8Array(Math.floor(Math.random() * 33));
          let outgoingMessage = server.sendMessage(clientPlayerId, message, () => {
            numAcksFromClient += 1;
          });
          outgoingMessage.ttl = undefined;
        }
      }
      serverAddMessagesThisFrame = !serverAddMessagesThisFrame;
    }
    server.flushMessagesToNetwork();
  }, 5, 'serverToClient');

  let timeoutId = setTimeout(() => {
    console.error('Test timed out');
    if (!isBeingDebugged()) {
      process.exit(1);
    }
  }, 1000000);

  let intervalId = setInterval(() => {
    metricsCollector.collectIntegrationTestMeasurements([
      {
        peerName: 'client',
        acksReceived: numAcksFromServer,
        messagesSent: clientIter,
      },
      {
        peerName: 'server',
        acksReceived: numAcksFromClient,
        messagesSent: serverIter,
      },
    ]);
    if (finishedSending() && numAcksFromServer === clientIter && numAcksFromClient === serverIter) {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      console.log('All acks received.');
      clientToServerHandle.stop();
      serverToClientHandle.stop();
      client.close();
      server.close();
      // This is rather silly but theres a bug where the server peerconnection
      // prevents node.js shutting down, which I haven't figured out the root cause of
      let shutdownTimeout = setTimeout(() => {
        console.error('Shutdown timed out');
        if (!isBeingDebugged()) {
          process.exit(0);
        }
      }, 100);
      // Don't let the shutdown timeout itself keep node running.
      shutdownTimeout.unref();
    }
  }, 50);
}

async function main() {
  let metricsCollector = await createMetricsCollector();
  let server = new NetworkServer(new ClassRegistry(), () => ({ playerId: clientPlayerId }));
  server.registerMessageType(TestMessage, 'TestMessage');
  server.registerMessageHandler(TestMessage, onMessageReceivedByServer);
  let addressInfo = await server.listen({
    signalingWebsocketServerPort: 0,
    webrtcPeerConnectionPortRange: {
      min: 11212,
      max: 11212,
    },
  });
  let serverHasClient = new Promise<void>((resolve) => {
    server.onConnection.attach(() => {
      resolve();
    });
  });

  let client = new NetworkClient(new ClassRegistry());
  client.registerMessageType(TestMessage, 'TestMessage');
  client.registerMessageHandler(TestMessage, onMessageReceivedByClient);
  await client.connect(`ws://127.0.0.1:${addressInfo.port}`);
  await serverHasClient;
  reliabilityTest(client, server, metricsCollector);
}

if (require.main === module) {
  main();
}
