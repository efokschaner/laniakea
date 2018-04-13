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

let clientEngine = new lk.ClientEngine({simFPS: demo.simFPS});

enum DemoType {
  BALLS,
  PONG
}
let demoType = DemoType.BALLS as DemoType;

let renderingSystem: lk.RenderingSystem;

switch(demoType) {
  case DemoType.BALLS:
    renderingSystem = new ballsDemo.RenderingSystemImpl(document.getElementById('scene')!);
    demo.ballsDemo.initialiseGame(clientEngine.engine);
    break;
  case DemoType.PONG:
    renderingSystem = new pongDemo.RenderingSystemImpl(document.getElementById('scene')!);
    pongDemo.initialiseClient(clientEngine);
    break;
  default:
    throw new Error('unimplemented');
}

enum GameButtons { UP, LEFT, DOWN, RIGHT }

clientEngine.registerInputButtons(GameButtons, (key: string) => {
  switch (key) {
    case 'w': return GameButtons.UP;
    case 'a': return GameButtons.LEFT;
    case 's': return GameButtons.DOWN;
    case 'd': return GameButtons.RIGHT;
  }
  return undefined;
});

clientEngine.setRenderingSystem(renderingSystem);
clientEngine.start();

var gameServerWsUrl = document.createElement('a') as HTMLAnchorElement & HTMLHyperlinkElementUtils;
gameServerWsUrl.href = demo.getGameServerWsUrl(location.hostname);
gameServerWsUrl.username = Math.round(Math.random() * 100).toString();
gameServerWsUrl.password = 'whateverpass';

clientEngine.connectToServer(gameServerWsUrl.href);
clientEngine.onConnectedToServer.attach(() => { console.log('Connected to server'); });
