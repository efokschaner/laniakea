import * as lk from 'laniakea-shared';

interface NumericEnum { [key: string]: number; }

function getEnumNames(e: NumericEnum): string[] {
  return Object.keys(e).filter((key) => isNaN(+key));
}

function getEnumValues(e: NumericEnum): number[] {
  return getEnumNames(e).map((name) => e[name]);
}

export enum ButtonState {
  UP,
  DOWN,
}

function serializeSetOfUint8(stream: lk.SerializationStream, set: Set<number>): void {
  let numEntries = {val: 0};
  if (stream.isWriting) {
    numEntries.val = set.size;
  }
  stream.serializeUint8(numEntries, 'val');
  if (stream.isWriting) {
    for (let value of set.values()) {
      let valueObj = { value };
      stream.serializeUint8(valueObj, 'value');
    }
  } else {
    set.clear();
    for (let i = 0; i < numEntries.val; ++i) {
      let valueObj = { value: 0 };
      stream.serializeUint8(valueObj, 'value');
      set.add(valueObj.value);
    }
  }
}

export enum GameButtons { LEFT, RIGHT }

export class GameButtonsInput implements lk.Serializable {
  public buttonStates = new Map<number, ButtonState>();
  constructor() {
    for (const button of getEnumValues(GameButtons as any)) {
      this.buttonStates.set(button, ButtonState.UP);
    }
  }
  public serialize(stream: lk.SerializationStream): void {
    // Buttons in the down state are sent, other buttons are assumed to be in the up state.
    let downButtons = new Set<number>();
    if (stream.isWriting) {
      this.buttonStates.forEach((value, key) => {
        if (value === ButtonState.DOWN) {
          downButtons.add(key);
        }
      });
    }
    serializeSetOfUint8(stream, downButtons);
    if (stream.isReading) {
      for (const button of getEnumValues(GameButtons as any)) {
        if (downButtons.has(button)) {
          this.buttonStates.set(button, ButtonState.DOWN);
        } else {
          this.buttonStates.set(button, ButtonState.UP);
        }
      }
    }
  }
}
