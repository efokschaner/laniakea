import { w3cwebsocket } from 'websocket';
(global as any).WebSocket = w3cwebsocket;

import { RTCPeerConnection } from 'wrtc';
(global as any).RTCPeerConnection = RTCPeerConnection;

import { NetworkClient } from 'laniakea-client';
import { NetworkServer, Serializable, SerializationStream, PlayerId } from 'laniakea-server';

function isBeingDebugged() {
  return typeof global.v8debug === 'object' || /--debug|--inspect/.test(process.execArgv.join(' '));
}

class TestPacket implements Serializable {
  public seq = 0;
  public data = new Uint8Array();
  public serialize(stream: SerializationStream): void {
    stream.serializeUint32(this, 'seq');
    stream.serializeUint8Array(this, 'data');
  }
}


function onPacketReceivedByServer(playerId: PlayerId, packet: TestPacket, sequenceNumber: number) : void {
  playerId;
  packet;
  sequenceNumber;
}


function onPacketReceivedByClient(packet: TestPacket, sequenceNumber: number) : void {
  packet;
  sequenceNumber;
}

let clientPlayerId = 0;

function runTest(client: NetworkClient, server: NetworkServer) {
  let numPackets = 100000; // larger than MAX_SEQUENCE_NUMBER_EXCLUSIVE in network code
  let roughMTU = 1100; // close to theoretical mtu

  let numAcksFromServer = 0;
  let sendFromClientAsync = (iter: number, maxIterations: number) => {
    let packet = new TestPacket();
    packet.seq = iter;
    let buffLen = Math.round(Math.random() * roughMTU);
    packet.data = new Uint8Array(buffLen);
    client.sendPacket(packet, function() {
      numAcksFromServer += 1;
    });
    iter += 1;
    if (iter < maxIterations) {
      setImmediate(sendFromClientAsync, iter, maxIterations);
    }
  }
  setImmediate(sendFromClientAsync, 0, numPackets);

  let numAcksFromClient = 0;
  let sendFromServerAsync = (iter: number, maxIterations: number) => {
    let packet = new TestPacket();
    packet.seq = iter;
    let buffLen = Math.round(Math.random() * roughMTU);
    packet.data = new Uint8Array(buffLen);
    server.sendPacket(clientPlayerId, packet, function() {
      numAcksFromClient += 1;
    });
    iter += 1;
    if (iter < maxIterations) {
      setImmediate(sendFromServerAsync, iter, maxIterations);
    }
  }
  setImmediate(sendFromServerAsync, 0, numPackets);

  let timeoutId = setTimeout(function() {
    console.error('Test timed out');
    if (!isBeingDebugged()) {
      process.exit(1);
    }
  }, 60000);

  let intervalId = setInterval(function() {
    console.log(`numAcksFromClient: ${numAcksFromClient}, numAcksFromServer: ${numAcksFromServer}`);
    if (numAcksFromServer === numPackets && numAcksFromClient === numPackets) {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      console.log('All acks received.');
      client.close();
      server.close();
    } else {
      // Flush acks to server
      client.sendPacket(new TestPacket());
      // Flush acks to client
      server.sendPacket(clientPlayerId, new TestPacket());
    }
  }, 500);
}

async function main() {
  let server = new NetworkServer(() => { return { playerId: clientPlayerId } });
  server.registerPacketType(TestPacket, 'TestPacket');
  server.registerPacketHandler(TestPacket, onPacketReceivedByServer);
  let addressInfo = await server.listen(0);
  let serverHasClient = new Promise<void>((resolve) => {
    server.onConnection.attach(() => {
      resolve();
    });
  });

  let client = new NetworkClient();
  client.registerPacketType(TestPacket, 'TestPacket');
  client.registerPacketHandler(TestPacket, onPacketReceivedByClient);
  await client.connect(`ws://127.0.0.1:${addressInfo.port}`);
  await serverHasClient;
  runTest(client, server);
}

if (require.main === module) {
  main();
}
