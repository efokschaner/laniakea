export type NumericEnum = { [key: string]: number; }

function getEnumNames(e: NumericEnum) : string[] {
  return Object.keys(e).filter(function (key) { return isNaN(+key); });
}

function getEnumValues(e: NumericEnum) : number[] {
  return getEnumNames(e).map(function (name) { return e[name]; });
};

export enum ButtonState {
  UP,
  DOWN
}

export class InputFrame {
  /**
   * For binary "button"-style input.
   * Eventually this class could also handle (parameterized) message style input.
   * These would be reliable (and probably ordered) by making use of the acking system
   * in the packet protocol (or likely the packet protocol should have a reliable send method).
   */
  buttons = new Map<number, ButtonState>();

  clone(): InputFrame {
    let clone = new InputFrame();
    clone.buttons = new Map(this.buttons);
    return clone;
  }
}

export function createInputFrame(buttonsEnum: NumericEnum): InputFrame {
  let inputFrame = new InputFrame();
  for (const button of getEnumValues(buttonsEnum)) {
    inputFrame.buttons.set(button, ButtonState.UP);
  }
  return inputFrame;
}


export function createInputFrameFromDownButtons(buttonsEnum: NumericEnum, downButtons: Set<number>): InputFrame {
  let newFrame = createInputFrame(buttonsEnum);
  for(let downButton of downButtons.values()) {
    newFrame.buttons.set(downButton, ButtonState.DOWN);
  }
  return newFrame;
}

export function createDownButtonsFromInputFrame(inputFrame: InputFrame): Set<number> {
  let result = new Set<number>();
  inputFrame.buttons.forEach((value, key) => {
    if(value === ButtonState.DOWN) {
      result.add(key);
    }
  });
  return result;
}


