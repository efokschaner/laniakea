// tslint:disable-next-line:no-var-requires
require('../css/main.css');

import * as lk from '@laniakea/client-engine';

import { GameButtons, GameButtonsInput, getGameServerWsUrl, initialiseEngine, simFPS } from 'lk-demo-balls-shared';

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

let clientEngine = new lk.ClientEngine({simFPS});

initialiseEngine(clientEngine);

clientEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');

// tslint:disable-next-line:no-unused-expression
new KeyboardHandler(clientEngine, GameButtonsInput, (key: string) => {
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
