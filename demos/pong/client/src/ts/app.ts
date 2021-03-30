// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../css/main.css');

import * as lk from '@laniakea/client-engine';
import {
  BallMovementSystem,
  ButtonState,
  EntityScheduledDeletionProcessor,
  GameButtons,
  GameButtonsInput,
  getGameServerWsUrl,
  globalSimulationRateMultiplier,
  InputHandlerSystem,
  PaddleMovementSystem,
  PaddlePositionSyncSystem,
  PolarLerp2DProcessor,
  registerComponents,
  simFPS,
} from 'lk-demo-pong-shared';

import { ClientSettings } from './client-settings';
import { doClientSideBotting } from './client-side-bot';
import { KeyboardHandler } from './keyboard-handler';
import { MockStorage } from './mock-storage';
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

let persistIdToLocalStorage = false;
let localStorage = persistIdToLocalStorage
  ? window.localStorage
  : new MockStorage();

function getUserId() {
  let prior = localStorage.getItem('user_id');
  if (prior) {
    return prior;
  }
  let newId = Math.round(Math.random() * 10000).toString();
  localStorage.setItem('user_id', newId);
  return newId;
}

let clientSettings = new ClientSettings(window.localStorage);

let clientEngine = new lk.ClientEngine({
  simFPS,
  globalSimulationRateMultiplier,
});

clientEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');
registerComponents(clientEngine);

let systems = [
  new InputHandlerSystem(),
  new PolarLerp2DProcessor(),
  new EntityScheduledDeletionProcessor(),
  new PaddleMovementSystem(),
  new PaddlePositionSyncSystem(),
  new BallMovementSystem(false),
];

function removeSystems() {
  for (let system of systems) {
    clientEngine.removeSystem(system);
  }
}

function addSystems() {
  // Remove systems first to get idempotent.
  removeSystems();
  for (let system of systems) {
    clientEngine.addSystem(system);
  }
}

function handleClientSimulationEnabledSetting(enabled: boolean) {
  if (enabled) {
    addSystems();
  } else {
    removeSystems();
  }
}

clientSettings.clientSimulationEnabled.attach(
  handleClientSimulationEnabledSetting
);
handleClientSimulationEnabledSetting(
  clientSettings.clientSimulationEnabled.value
);

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
new KeyboardHandler(clientEngine, GameButtonsInput, (key: string) => {
  switch (key) {
    case 'a':
      return GameButtons.LEFT;
    case 'd':
      return GameButtons.RIGHT;
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

let renderingSystem = new RenderingSystemImpl(sceneElement, clientSettings);
clientEngine.setRenderingSystem(renderingSystem);

clientEngine.start();

let gameServerWsUrl = document.createElement('a') as HTMLAnchorElement &
  HTMLHyperlinkElementUtils;
gameServerWsUrl.href = getGameServerWsUrl(location.hostname);

gameServerWsUrl.username = getUserId();
gameServerWsUrl.password = 'whateverpass';

clientEngine.onConnectedToServer.attach(() => {
  console.log('Connected to server');
});
void clientEngine.connectToServer(gameServerWsUrl.href);

setInterval(() => {
  if (clientSettings.clientIsBot) {
    doClientSideBotting(
      clientEngine.clientSimulation,
      clientEngine.getCurrentContinuousInput(GameButtonsInput)!
    );
  }
}, 25);
