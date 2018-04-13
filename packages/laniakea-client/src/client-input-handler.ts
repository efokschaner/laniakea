import {
  ButtonState,
  C2S_InputFramePacket,
  CyclicBuffer,
  createDownButtonsFromInputFrame,
  createInputFrame,
  InputFrame,
  NumericEnum
} from 'laniakea-shared';

import { ServerTimeEstimator } from './server-time-estimator';
import { NetworkClient } from './network-client';
import { ClientSimulation } from './client-simulation';

export class ClientInputHandler {
  constructor(
      private serverTimeEstimator: ServerTimeEstimator,
      private clientSimulation: ClientSimulation,
      private networkClient: NetworkClient) {
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));
    // TODO maybe set all buttons up on a "blur" event (when game loses focus)
  }

  registerButtons(
      buttonsEnum: NumericEnum,
      buttonMappingCallback: (keyboardKey: string) => number | undefined) {
    this.buttonsEnum = buttonsEnum;
    this.buttonMappingCallback = buttonMappingCallback;
    this.currentInputState = createInputFrame(this.buttonsEnum)
  }

  update() {
    if(this.buttonsEnum === undefined) {
      // No buttons registered, no-op
      return;
    }
    let buttonsEnum = this.buttonsEnum;
    let serverSimTimeS = this.serverTimeEstimator.getServerSimulationTimeS();
    let packetRttS = this.serverTimeEstimator.getPacketRoundTripTimeS();
    let targetSimulationTimeS : number | undefined;
    let packet = new C2S_InputFramePacket();
    packet.downButtons = createDownButtonsFromInputFrame(this.currentInputState);
    if (serverSimTimeS !== undefined && packetRttS !== undefined) {
      targetSimulationTimeS = serverSimTimeS + (packetRttS / 2);
      packet.targetSimulationTimeS = targetSimulationTimeS;
    }
    if (targetSimulationTimeS !== undefined) {
      this.clientSimulation.notifyInputBeingSent(this.currentInputState.clone(), targetSimulationTimeS);
    }
  }

  private getMappedButtonToChange(keyboardEvent: KeyboardEvent): number|undefined {
    if(this.buttonMappingCallback === undefined || this.buttonsEnum === undefined) {
      // No input handling registerd yet so we ignore
      return undefined;
    }
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
    this.currentInputState.buttons.set(mappedButton, ButtonState.DOWN);
  }

  private onKeyUp(keyUpEvent: KeyboardEvent) {
    let mappedButton = this.getMappedButtonToChange(keyUpEvent);
    if(mappedButton === undefined) {
      return;
    }
    this.currentInputState.buttons.set(mappedButton, ButtonState.UP);
  }

  private currentInputState = new InputFrame();
  private buttonsEnum?: NumericEnum;
  private buttonMappingCallback?: (keyboardKey: string) => number | undefined;
}