import * as lk from '@laniakea/client-engine';
import {
  BallMovement,
  ButtonState,
  calculateBestMoveIntent,
  GameButtons,
  GameButtonsInput,
  getPersistentIndexToWallDataMap,
  HumanPlayerId,
  MoveIntent,
  Paddle,
  PlayerInfo,
  Position2,
} from 'lk-demo-pong-shared';

export function doClientSideBotting(
  simulation: lk.ClientSimulation,
  buttonsInput: GameButtonsInput
): void {
  let simTimeS = simulation.getCurrentSimulationTimeS();
  if (simTimeS === undefined) {
    // Nothing to do yet
    return;
  }

  let targetSimTimeS = simTimeS + simulation.getInputTravelTimeS()!;
  let nearestFrames = simulation.getSimulationFrames(targetSimTimeS);
  if (nearestFrames === undefined) {
    // Nothing to do yet
    return;
  }

  let state = nearestFrames.current.state;
  let ownPlayerId = simulation.getOwnPlayerId()!;
  let ownPlayerInfo: PlayerInfo | undefined;
  for (let [playerInfo, humanPlayerId] of state.getAspect(
    PlayerInfo,
    HumanPlayerId
  )) {
    if (humanPlayerId.getData().playerId === ownPlayerId) {
      ownPlayerInfo = playerInfo.getData();
      break;
    }
  }
  if (ownPlayerInfo === undefined || !ownPlayerInfo.alive) {
    // Dead, ignore
    return;
  }

  let ownPaddle: Paddle | undefined;
  for (let paddle of state.getComponents(Paddle)) {
    if (paddle.getData().playerIndex === ownPlayerInfo.playerIndex) {
      ownPaddle = paddle.getData();
      break;
    }
  }
  if (ownPaddle === undefined) {
    return;
  }

  let persistentIndexToWallData = getPersistentIndexToWallDataMap(state);
  let wall = persistentIndexToWallData.get(ownPaddle.wallPersistentId)!;
  let balls = Array.from(state.getAspect(BallMovement, Position2));
  let moveIntent = calculateBestMoveIntent(ownPaddle, wall, balls);
  buttonsInput.buttonStates.clear();
  switch (moveIntent) {
    case MoveIntent.NEGATIVE:
      buttonsInput.buttonStates.set(GameButtons.RIGHT, ButtonState.DOWN);
      break;
    case MoveIntent.POSITIVE:
      buttonsInput.buttonStates.set(GameButtons.LEFT, ButtonState.DOWN);
      break;
    case MoveIntent.NONE:
      break;
    default:
      console.warn('Unhandled moveIntent');
      break;
  }
}
