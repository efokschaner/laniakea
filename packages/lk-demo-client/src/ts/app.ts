require('../css/main.css');

const present = require('present');

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-shared';

import * as ballsDemo from './balls-demo';
import * as pongDemo from './pong-demo';

interface HTMLHyperlinkElementUtils {
  href: string;
  readonly origin: string;
  protocol: string;
  username: string;
  password: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
};

enum DemoType {
  BALLS,
  PONG
}
let demoType = DemoType.PONG as DemoType;

let renderingSystem: lk.RenderingSystem;

switch(demoType) {
  case DemoType.BALLS:
    renderingSystem = new ballsDemo.RenderingSystemImpl(document.getElementById('scene')!);
    break;
  case DemoType.PONG:
    renderingSystem = new pongDemo.RenderingSystemImpl(document.getElementById('scene')!);
    break;
  default:
    throw new Error('unimplemented');
}

let clientEngine = new lk.ClientEngine(renderingSystem, demo.simFPS);

switch(demoType) {
  case DemoType.BALLS:
    demo.ballsDemo.initialiseGame(clientEngine.engine);
    break;
  case DemoType.PONG:
    pongDemo.initialiseClient(clientEngine);
    break;
  default:
    throw new Error('unimplemented');
}

clientEngine.start();

var gameServerWsUrl = document.createElement('a') as HTMLAnchorElement & HTMLHyperlinkElementUtils;
gameServerWsUrl.href = demo.getGameServerWsUrl(location.hostname);
gameServerWsUrl.username = Math.round(Math.random() * 100).toString();
gameServerWsUrl.password = 'whateverpass';

clientEngine.networkClient.connect(gameServerWsUrl.href);
clientEngine.networkClient.onConnected.attach(() => { console.log('Connected to server'); });

let logcounter = 0;
clientEngine.networkClient.onPacketReceived.attach(msg => {
  let dataView = new DataView(msg.buffer, msg.byteOffset, msg.byteLength);
  let readStream = new lk.ReadStream(dataView);
  let framePacket = new lk.S2C_FrameUpdatePacket();
  framePacket.serialize(readStream);
  let componentDataDataView = new DataView(framePacket.componentData.buffer, framePacket.componentData.byteOffset, framePacket.componentData.byteLength);
  clientEngine.engine.serialize(new lk.ReadStream(componentDataDataView));
  if(++logcounter % 100 == 0) {
    console.log('message length:', msg.byteLength);
  }
});