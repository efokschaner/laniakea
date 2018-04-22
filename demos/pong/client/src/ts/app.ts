// tslint:disable-next-line:no-var-requires
require('../css/main.css');
// tslint:disable-next-line:no-var-requires
require('imports-loader?THREE=three!three/examples/js/controls/OrbitControls.js');

import * as lk from 'laniakea-client';
import {
  BallMovementSystem,
  EntityScheduledDeletionProcessor,
  GameButtons,
  GameButtonsInput,
  getGameServerWsUrl,
  InputHandlerSystem,
  Lerp2DProcessor,
  PaddleMovementSystem,
  PaddlePositionSyncSystem,
  registerComponents,
  simFPS,
} from 'lk-demo-pong-shared';

import { KeyboardHandler } from './keyboard-handler';
import { RenderingSystemImpl } from './pong-renderer';

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

clientEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');
registerComponents(clientEngine.engine);

clientEngine.engine.addSystem(new InputHandlerSystem());
clientEngine.engine.addSystem(new Lerp2DProcessor());
clientEngine.engine.addSystem(new EntityScheduledDeletionProcessor());
clientEngine.engine.addSystem(new PaddleMovementSystem());
clientEngine.engine.addSystem(new BallMovementSystem());
clientEngine.engine.addSystem(new PaddlePositionSyncSystem());

// tslint:disable-next-line:no-unused-variable
let keyboardHandler = new KeyboardHandler(clientEngine, GameButtonsInput, (key: string) => {
  switch (key) {
    case 'a': return GameButtons.LEFT;
    case 'd': return GameButtons.RIGHT;
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
