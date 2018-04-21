// tslint:disable-next-line:no-var-requires
require('../css/main.css');
// tslint:disable-next-line:no-var-requires
require('imports-loader?THREE=three!three/examples/js/controls/OrbitControls.js');

import * as lk from 'laniakea-client';

import { GameButtons, GameButtonsInput, initialiseEngine, simFPS, getGameServerWsUrl } from 'lk-demo-balls-shared';

import { RenderingSystemImpl } from './balls-renderer';
import { KeyboardHandler } from './keyboard-handler';

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

let clientEngine = new lk.ClientEngine({simFPS: simFPS});

initialiseEngine(clientEngine.engine);

clientEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');

// tslint:disable-next-line:no-unused-variable
let keyboardHandler = new KeyboardHandler(clientEngine, GameButtonsInput, (key: string) => {
  switch (key) {
    case 'w': return GameButtons.UP;
    case 's': return GameButtons.DOWN;
  }
  return undefined;
});

let renderingSystem = new RenderingSystemImpl(document.getElementById('scene')!);
clientEngine.setRenderingSystem(renderingSystem);

clientEngine.start();

let gameServerWsUrl = document.createElement('a') as HTMLAnchorElement & HTMLHyperlinkElementUtils;
gameServerWsUrl.href = getGameServerWsUrl(location.hostname);
gameServerWsUrl.username = Math.round(Math.random() * 100).toString();
gameServerWsUrl.password = 'whateverpass';

clientEngine.connectToServer(gameServerWsUrl.href);
clientEngine.onConnectedToServer.attach(() => { console.log('Connected to server'); });
