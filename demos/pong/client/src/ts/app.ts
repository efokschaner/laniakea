// tslint:disable-next-line:no-var-requires
require('../css/main.css');
// tslint:disable-next-line:no-var-requires
require('imports-loader?THREE=three!three/examples/js/controls/OrbitControls.js');

import * as lk from 'laniakea-client';
import {
  BallMovementSystem,
  ButtonState,
  EntityScheduledDeletionProcessor,
  GameButtons,
  GameButtonsInput,
  getGameServerWsUrl,
  globalSimulationRateMultiplier,
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

function getUserId() {
  let prior = window.localStorage.getItem('user_id');
  if (prior) {
    return prior;
  }
  let newId = Math.round(Math.random() * 10000).toString();
  window.localStorage.setItem('user_id', newId);
  return newId;
}

let clientEngine = new lk.ClientEngine({simFPS, globalSimulationRateMultiplier});

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

let sceneElement = document.getElementById('scene')!;

// Caution: this touch handling is super scrappy
function handleTouches(ev: TouchEvent) {
  let touch = ev.touches[0];
  let buttonsInput = clientEngine.getCurrentContinuousInput(GameButtonsInput)!;
  if (touch === undefined) {
    for (let button of buttonsInput.buttonStates.keys()) {
      buttonsInput.buttonStates.set(button, ButtonState.UP);
    }
    return;
  }
  if (touch.clientX < sceneElement.clientWidth / 2) {
    buttonsInput.buttonStates.set(GameButtons.LEFT, ButtonState.DOWN);
    buttonsInput.buttonStates.set(GameButtons.RIGHT, ButtonState.UP);
  } else {
    buttonsInput.buttonStates.set(GameButtons.LEFT, ButtonState.UP);
    buttonsInput.buttonStates.set(GameButtons.RIGHT, ButtonState.DOWN);
  }
}

sceneElement.addEventListener('touchstart', handleTouches, false);
sceneElement.addEventListener('touchend', handleTouches, false);
sceneElement.addEventListener('touchcancel', handleTouches, false);
sceneElement.addEventListener('touchmove', handleTouches, false);

let renderingSystem = new RenderingSystemImpl(sceneElement);
clientEngine.setRenderingSystem(renderingSystem);

clientEngine.start();

let gameServerWsUrl = document.createElement('a') as HTMLAnchorElement & HTMLHyperlinkElementUtils;
gameServerWsUrl.href = getGameServerWsUrl(location.hostname);

gameServerWsUrl.username = getUserId();
gameServerWsUrl.password = 'whateverpass';

clientEngine.connectToServer(gameServerWsUrl.href);
clientEngine.onConnectedToServer.attach(() => { console.log('Connected to server'); });
