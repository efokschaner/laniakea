// tslint:disable-next-line:no-var-requires
require('../css/main.css');
// tslint:disable-next-line:no-var-requires
require('imports-loader?THREE=three!three/examples/js/controls/OrbitControls.js');

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-pong-shared';

import * as ballsDemo from './balls-demo';
import { KeyboardHandler } from './keyboard-handler';
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
}

let clientEngine = new lk.ClientEngine({simFPS: demo.simFPS});

enum DemoType {
  BALLS,
  PONG,
}
let demoType = DemoType.PONG as DemoType;

let renderingSystem: lk.RenderingSystem;

switch (demoType) {
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

clientEngine.registerContinuousInputType(demo.GameButtonsInput, 'GameButtonsInput');

// tslint:disable-next-line:no-unused-variable
let keyboardHandler = new KeyboardHandler(clientEngine, demo.GameButtonsInput, (key: string) => {
  switch (key) {
    case 'w': return demo.GameButtons.UP;
    case 'a': return demo.GameButtons.LEFT;
    case 's': return demo.GameButtons.DOWN;
    case 'd': return demo.GameButtons.RIGHT;
  }
  return undefined;
});

clientEngine.setRenderingSystem(renderingSystem);

clientEngine.start();

let gameServerWsUrl = document.createElement('a') as HTMLAnchorElement & HTMLHyperlinkElementUtils;
gameServerWsUrl.href = demo.getGameServerWsUrl(location.hostname);
gameServerWsUrl.username = Math.round(Math.random() * 100).toString();
gameServerWsUrl.password = 'whateverpass';

clientEngine.connectToServer(gameServerWsUrl.href);
clientEngine.onConnectedToServer.attach(() => { console.log('Connected to server'); });
