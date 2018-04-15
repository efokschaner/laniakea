require('../css/main.css');

const present = require('present');

import * as lk from 'laniakea-client';
import * as demo from 'lk-demo-shared';

import * as ballsDemo from './balls-demo';
import * as pongDemo from './pong-demo';
import { ClientEngine } from 'laniakea-client';

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

// Boilerplate keyboard handler. TODO extract to some kind of demo-utils package when we split demos out.
class KeyboardHandler {
  /**
   * @param buttonMappingCallback accepts https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
   * should return a value from your buttonsEnum or undefined if the button is not used.
   */
  constructor(
    private clientEngine: ClientEngine,
    private buttonMappingCallback: (keyboardKey: string) => number | undefined) {
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));
    // TODO maybe set all buttons up on a "blur" event (when game loses focus)
  }

  private getMappedButtonToChange(keyboardEvent: KeyboardEvent): number|undefined {
    if(keyboardEvent.repeat) {
      // Ignore
      return undefined;
    }
    let mappedButton = this.buttonMappingCallback(keyboardEvent.key);
    if(mappedButton === undefined) {
      // User wants to ignore button.
      return undefined;
    }
    return mappedButton;
  }

  private onKeyDown(keyDownEvent: KeyboardEvent) {
    let mappedButton = this.getMappedButtonToChange(keyDownEvent);
    if(mappedButton === undefined) {
      return;
    }
    let buttonsInput = this.clientEngine.getCurrentContinuousInput(demo.GameButtonsInput)!;
    buttonsInput.buttonStates.set(mappedButton, demo.ButtonState.DOWN);
  }

  private onKeyUp(keyUpEvent: KeyboardEvent) {
    let mappedButton = this.getMappedButtonToChange(keyUpEvent);
    if(mappedButton === undefined) {
      return;
    }
    let buttonsInput = this.clientEngine.getCurrentContinuousInput(demo.GameButtonsInput)!;
    buttonsInput.buttonStates.set(mappedButton, demo.ButtonState.UP);
  }
}


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

clientEngine.registerContinuousInputType(demo.GameButtonsInput, 'GameButtonsInput');

new KeyboardHandler(clientEngine, (key: string) => {
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

var gameServerWsUrl = document.createElement('a') as HTMLAnchorElement & HTMLHyperlinkElementUtils;
gameServerWsUrl.href = demo.getGameServerWsUrl(location.hostname);
gameServerWsUrl.username = Math.round(Math.random() * 100).toString();
gameServerWsUrl.password = 'whateverpass';

clientEngine.connectToServer(gameServerWsUrl.href);
clientEngine.onConnectedToServer.attach(() => { console.log('Connected to server'); });
