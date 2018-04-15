import * as ballsDemoImport from './balls-demo';
export const ballsDemo = ballsDemoImport;

import * as pongDemoImport from './pong-demo';
import { Serializable, SerializationStream } from 'laniakea-shared';
export const pongDemo = pongDemoImport;

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}` };
export const simFPS = 20;

type NumericEnum = { [key: string]: number; }

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

function serializeSetOfUint8(stream: SerializationStream, set: Set<number>): void {
  let numEntries = {val:0};
  if(stream.isWriting) {
    numEntries.val = set.size;
  }
  stream.serializeUint8(numEntries, 'val');
  if(stream.isWriting) {
    for(let number of set.values()) {
      let numberObj = { number };
      stream.serializeUint8(numberObj, 'number');
    }
  } else {
    set.clear();
    for(let i = 0; i < numEntries.val; ++i) {
      let numberObj = { number: 0 };
      stream.serializeUint8(numberObj, 'number');
      set.add(numberObj.number);
    }
  }
}

/**
 * Generates a class that provides binary "button"-style inputs as continuous input to the engine.
 * Knowledge of possible button inputs allows efficient serialization
 * @param buttonsEnum Either a TypeScript enum or an object of string keys to numeric values
 *                    that describes the button-style inputs you support in a keyboard-agnostic form.
 */
function createButtonsInputType(buttonsEnum: any) {
  return class implements Serializable {
    public buttonStates = new Map<number, ButtonState>();
    constructor() {
      for (const button of getEnumValues(buttonsEnum)) {
        this.buttonStates.set(button, ButtonState.UP);
      }
    }
    serialize(stream: SerializationStream): void {
      //Buttons in the down state are sent, other buttons are assumed to be in the up state.
      let downButtons = new Set<number>();
      if(stream.isWriting) {
        this.buttonStates.forEach((value, key) => {
          if(value === ButtonState.DOWN) {
            downButtons.add(key);
          }
        });
      }
      serializeSetOfUint8(stream, downButtons);
      if(stream.isReading) {
        for (const button of getEnumValues(buttonsEnum)) {
          if(downButtons.has(button)) {
            this.buttonStates.set(button, ButtonState.DOWN);
          } else {
            this.buttonStates.set(button, ButtonState.UP);
          }
        }
      }
    }
  }
}

export enum GameButtons { UP, LEFT, DOWN, RIGHT };

export let GameButtonsInput = createButtonsInputType(GameButtons);