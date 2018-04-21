import { ClientEngine, Serializable } from 'laniakea-client';
import { ButtonState } from 'lk-demo-shared';

// Boilerplate keyboard handler. TODO extract to some kind of demo-utils package when we split demos out.
export class KeyboardHandler<T extends Serializable & {buttonStates: Map<number, ButtonState>}> {
  /**
   * @param buttonMappingCallback accepts https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key
   * should return a value from your buttonsEnum or undefined if the button is not used.
   */
  constructor(
    private clientEngine: ClientEngine,
    private inputType: { new (): T; },
    private buttonMappingCallback: (keyboardKey: string) => number | undefined) {
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));
    // TODO maybe set all buttons up on a "blur" event (when game loses focus)
  }

  private getMappedButtonToChange(keyboardEvent: KeyboardEvent): number|undefined {
    if (keyboardEvent.repeat) {
      // Ignore
      return undefined;
    }
    let mappedButton = this.buttonMappingCallback(keyboardEvent.key);
    if (mappedButton === undefined) {
      // User wants to ignore button.
      return undefined;
    }
    return mappedButton;
  }

  private onKeyDown(keyDownEvent: KeyboardEvent) {
    let mappedButton = this.getMappedButtonToChange(keyDownEvent);
    if (mappedButton === undefined) {
      return;
    }
    let buttonsInput = this.clientEngine.getCurrentContinuousInput(this.inputType)!;
    buttonsInput.buttonStates.set(mappedButton, ButtonState.DOWN);
  }

  private onKeyUp(keyUpEvent: KeyboardEvent) {
    let mappedButton = this.getMappedButtonToChange(keyUpEvent);
    if (mappedButton === undefined) {
      return;
    }
    let buttonsInput = this.clientEngine.getCurrentContinuousInput(this.inputType)!;
    buttonsInput.buttonStates.set(mappedButton, ButtonState.UP);
  }
}
