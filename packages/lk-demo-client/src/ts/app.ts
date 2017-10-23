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

let clientEngine = new lk.ClientEngine(demo.simFPS);

enum DemoType {
  BALLS,
  PONG
}
let demoType = DemoType.PONG as DemoType;

switch(demoType) {
  case DemoType.BALLS:
    clientEngine.setRenderingSystem(new ballsDemo.RenderingSystemImpl(document.getElementById('scene')!));
    demo.ballsDemo.initialiseGame(clientEngine.engine);
    break;
  case DemoType.PONG:
    clientEngine.setRenderingSystem(new pongDemo.RenderingSystemImpl(document.getElementById('scene')!, clientEngine));
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
