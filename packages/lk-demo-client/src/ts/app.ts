require('../css/main.css');

const present = require('present');

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-shared';
import * as ballsDemo from './balls-demo';

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

let renderingSystem = new ballsDemo.RenderingSystemImpl(document.getElementById('scene')!);

let clientEngine = new lk.ClientEngine(renderingSystem, demo.simFPS);

demo.ballsDemo.initialiseGame(clientEngine.engine);

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