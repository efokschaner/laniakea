import * as lk from '@laniakea/base-engine';
import * as THREE from 'three';
import {
  BallMovement,
  BallSpawner,
  GamePhase,
  PlayerInfo,
  Position2,
} from './components';
import { getCurrentGamePhase } from './game-phase';

function getOrCreateBallSpawner(
  state: lk.EntityComponentState
): lk.Component<BallSpawner> {
  let spawners = Array.from(state.getComponents(BallSpawner));
  let spawner = spawners[0];
  if (spawner !== undefined) {
    return spawner;
  }
  let spawnerComponent = new BallSpawner();
  return state.createEntity().setComponent(spawnerComponent);
}

export class BallSpawnerSystem implements lk.System {
  public Step({ simulationTimeS, state }: lk.StepParams): void {
    if (getCurrentGamePhase(state) !== GamePhase.Playing) {
      return;
    }
    let spawner = getOrCreateBallSpawner(state);
    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let balls = Array.from(state.getComponents(BallMovement));
    let desiredNumBalls = alivePlayers.length;
    let hasBeenMoreThanASecondSinceLastSpawn =
      spawner.getData().lastBallSpawnTimeS <= simulationTimeS - 1;
    if (
      hasBeenMoreThanASecondSinceLastSpawn &&
      balls.length < desiredNumBalls
    ) {
      spawner.getData().lastBallSpawnTimeS = simulationTimeS;
      let initialBallVelocityMagnitude = 4;
      let ballPos = new Position2();
      let ballMovement = new BallMovement();
      ballMovement.velocity.x = 1;
      ballMovement.velocity.rotateAround(
        new THREE.Vector2(),
        Math.random() * 2 * Math.PI
      );
      ballMovement.velocity.setLength(initialBallVelocityMagnitude);
      let ball = state.createEntity();
      ball.setComponent(ballPos);
      ball.setComponent(ballMovement);
    }
  }
}
