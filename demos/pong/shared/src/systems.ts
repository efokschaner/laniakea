import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  BallMovement,
  BallSpawner,
  EntityScheduledDeletion,
  HumanPlayerId,
  Lerp2D,
  MoveIntent,
  Orientation,
  Paddle,
  PlayerInfo,
  Position2,
  WallVertex,
} from './components';

import { ButtonState, GameButtons, GameButtonsInput } from './inputs';

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

export class Lerp2DProcessor implements lk.System {
  public Step({simulationTimeS, state}: lk.StepParams): void {
    for (let [_, position, lerp] of state.getAspect(WallVertex, Position2, Lerp2D)) {
      let lerpData = lerp.getData();
      let lerpFactor = (simulationTimeS - lerpData.startTimeS) / lerpData.durationS;
      if (lerpFactor < 0) {
        continue;
      }
      if (lerpFactor >= 1) {
        lerpFactor = 1;
        lerp.delete();
      }
      // Just for a bit of fun this is technically not a L(inear int)erp-olation anymore but whatever
      let smoothLerpFactor = THREE.Math.smoothstep(lerpFactor, 0, 1);
      position.getData().lerpVectors(lerpData.originalPosition, lerpData.targetPosition, smoothLerpFactor);
    }
  }
}

export class EntityScheduledDeletionProcessor implements lk.System {
  public Step({simulationTimeS, state}: lk.StepParams): void {
    for (let schedule of state.getComponents(EntityScheduledDeletion)!) {
      let scheduleData = schedule.getData();
      if (scheduleData.deletionTimeS <= simulationTimeS) {
        state.deleteEntity(schedule.getOwnerId());
      }
    }
  }
}

// Side calculation will use the formula d=(x−x1)(y2−y1)−(y−y1)(x2−x1)
// Where (x1,y1) and (x2,y2) are points on the wall and (x,y) is the point.
// Here we will pre-calculate (y2−y1) and (x2−x1), i.e vertA - vertB on the wall
interface WallData {
  wallPoint: THREE.Vector2;
  wallUnitVec: THREE.Vector2;
}
function wallPointsToWallData(pointA: THREE.Vector2, pointB: THREE.Vector2): WallData {
  let wallUnitVec = pointB.clone().sub(pointA).normalize();
  return {
    wallPoint: pointA,
    wallUnitVec,
  };
}
function crossProduct2DBetweenWallAndPoint(wallData: WallData, point: THREE.Vector2) {
  let wallPointToPoint = point.clone().sub(wallData.wallPoint);
  return (wallPointToPoint.x * wallData.wallUnitVec.y) - (wallPointToPoint.y * wallData.wallUnitVec.x);
}

export class BallMovementSystem implements lk.System {
  public Step({timeDeltaS, state, previousFrameState}: lk.StepParams): void {
    // For calculating collisions we want all wall vertices that existed on previous frame and this frame.
    let vertsToConsider = new Array<{prev: lk.Component<Position2>, next: lk.Component<Position2>, visualIndex: number}>();
    for (let [prevVert, prevPos] of previousFrameState.getAspect(WallVertex, Position2)) {
      let maybeNextPos = state.getComponent(Position2, prevPos.getId());
      if (maybeNextPos !== undefined) {
        vertsToConsider.push({prev: prevPos, next: maybeNextPos, visualIndex: prevVert.getData().visualIndex });
      }
    }
    let vertsToConsiderSorted = vertsToConsider.sort((a, b) => a.visualIndex - b.visualIndex);
    let walls = new Array<{prev: WallData, next: WallData}>();
    for (let i = 0; i < vertsToConsiderSorted.length; ++i) {
      let startIndex = i;
      let endIndex = mod(i + 1, vertsToConsiderSorted.length);
      let startVerts = vertsToConsiderSorted[startIndex];
      let endVerts = vertsToConsiderSorted[endIndex];
      walls.push({
        prev: wallPointsToWallData(startVerts.prev.getData(), endVerts.prev.getData()),
        next: wallPointsToWallData(startVerts.next.getData(), endVerts.next.getData()),
      });
    }

    for (let [ballPosition, ballMovement] of state.getAspect(Position2, BallMovement)) {
      let ballMovementData = ballMovement.getData();
      let prevPos = ballPosition.getData().clone();
      let nextPos = ballPosition.getData().addScaledVector(ballMovementData.velocity, timeDeltaS);
      // Calculate collisions by checking sign change in outer product with wall on previous frame and next
      for (let wall of walls) {
        let prevProduct = crossProduct2DBetweenWallAndPoint(wall.prev, prevPos);
        let nextProduct = crossProduct2DBetweenWallAndPoint(wall.next, nextPos);
        // We only care about collisions with the ball going outwards (to prevent numerical issue with the ball getting stuck outside the shape)
        if (prevProduct > 0 && nextProduct <= 0) {
          // There's been a sign change, reflect the velocity and position
          let wallNormInwards = new THREE.Vector2(wall.next.wallUnitVec.y, -wall.next.wallUnitVec.x);
          // reflection using the following formula r=d−2(d⋅n)n
          // where d is the vector to reflect, r is the reflected result, and n is the unit normal
          let minusTwoDdotN = - 2 * ballMovementData.velocity.dot(wallNormInwards);
          ballMovementData.velocity.addScaledVector(wallNormInwards, minusTwoDdotN);

          // Position reflection is done by projecting the ball to the wall and adding twice that vec to pos.
          let wallData = wall.next;
          let wallRay = new THREE.Ray(
            new THREE.Vector3(wallData.wallPoint.x, wallData.wallPoint.y),
            new THREE.Vector3(wallData.wallUnitVec.x, wallData.wallUnitVec.y));
          let ballPos3D = new THREE.Vector3(nextPos.x, nextPos.y);
          let wallPointClosestToBall = wallRay.closestPointToPoint(ballPos3D, new THREE.Vector3());
          let ballToWall = new THREE.Vector2();
          ballToWall.copy(wallPointClosestToBall.sub(ballPos3D) as any);
          nextPos.addScaledVector(ballToWall, 2);

        }
      }
    }
  }
}

function getOrCreateBallSpawner(state: lk.EntityComponentState): lk.Component<BallSpawner> {
  let spawners = Array.from(state.getComponents(BallSpawner));
  let spawner = spawners[0];
  if (spawner !== undefined) {
    return spawner;
  }
  let spawnerComponent = new BallSpawner();
  let newEntity = state.createEntity([spawnerComponent]);
  return newEntity.getComponent(BallSpawner)!;
}

export class BallSpawnerSystem implements lk.System {
  public Step({simulationTimeS, state}: lk.StepParams): void {
    let spawner = getOrCreateBallSpawner(state);
    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let balls = Array.from(state.getComponents(BallMovement));
    let desiredNumBalls = Math.floor(alivePlayers.length / 2);
    let hasBeenMoreThanASecondSinceLastSpawn = spawner.getData().lastBallSpawnTimeS <= simulationTimeS - 1;
    if (hasBeenMoreThanASecondSinceLastSpawn && balls.length < desiredNumBalls) {
      spawner.getData().lastBallSpawnTimeS = simulationTimeS;
      let initialBallVelocityMagnitude = 2.5;
      let ballPos = new Position2();
      let ballMovement = new BallMovement();
      ballMovement.velocity.x = 1;
      ballMovement.velocity.rotateAround(new THREE.Vector2(), Math.random() * 2 * Math.PI);
      ballMovement.velocity.setLength(initialBallVelocityMagnitude);
      state.createEntity([ballPos, ballMovement]);
    }
  }
}

export class InputHandlerSystem implements lk.System {
  public Step({inputs, state}: lk.StepParams): void {
    let playerIdToPlayerInfoMap = new Map(
      Array.from(
        state.getAspect(PlayerInfo, HumanPlayerId),
      ).map(
        ([info, playerId]) => [playerId.getData().playerId, info.getData()] as [lk.PlayerId, PlayerInfo],
      ),
    );
    let playerIndexToPaddleMap = new Map(
      Array.from(
        state.getComponents(Paddle),
      ).map(
        (paddle) => [paddle.getData().playerIndex, paddle.getData()] as [number, Paddle],
      ),
    );
    for (let [playerId, input] of inputs) {
      let maybePlayerInfo = playerIdToPlayerInfoMap.get(playerId);
      if (maybePlayerInfo === undefined) {
        continue;
      }
      let maybePaddle = playerIndexToPaddleMap.get(maybePlayerInfo.playerIndex);
      if (maybePaddle === undefined) {
        continue;
      }
      let maybeButtonsInput = input.getContinuousInput(GameButtonsInput);
      if (maybeButtonsInput === undefined) {
        continue;
      }
      if (maybeButtonsInput.buttonStates.get(GameButtons.LEFT) === ButtonState.DOWN) {
        maybePaddle.moveIntent = MoveIntent.POSITIVE;
      } else if (maybeButtonsInput.buttonStates.get(GameButtons.RIGHT) === ButtonState.DOWN) {
        maybePaddle.moveIntent = MoveIntent.NEGATIVE;
      } else {
        maybePaddle.moveIntent = MoveIntent.NONE;
      }
    }
  }
}

export let paddleLengthAsProportionOfWallLength = 0.1;

export class PaddleMovementSystem implements lk.System {
  public Step({state, timeDeltaS}: lk.StepParams): void {
    for (let paddle of state.getComponents(Paddle)) {
      let paddleData = paddle.getData();
      // TODO consider an accelerative approach
      let maxMoveSpeed = 0.6;
      switch (paddleData.moveIntent) {
        case MoveIntent.NONE:
          paddleData.velocityInWallSpace = 0;
          break;
        case MoveIntent.NEGATIVE:
          paddleData.velocityInWallSpace = - maxMoveSpeed;
          break;
        case MoveIntent.POSITIVE:
          paddleData.velocityInWallSpace = maxMoveSpeed;
          break;
      }

      // TODO adjust clamp so paddle width is accounted for
      paddleData.positionInWallSpace = THREE.Math.clamp(
        paddleData.positionInWallSpace + paddleData.velocityInWallSpace * timeDeltaS,
        0.5 * paddleLengthAsProportionOfWallLength,
        1 - (0.5 * paddleLengthAsProportionOfWallLength));
    }
  }
}

export class PaddlePositionSyncSystem implements lk.System {
  public Step({state}: lk.StepParams): void {
    let vertsSortedByVisualIndex = Array.from(state.getAspect(WallVertex, Position2)).sort((a, b) => a[0].getData().visualIndex - b[0].getData().visualIndex);
    for (let [pos, paddle, orientation] of state.getAspect(Position2, Paddle, Orientation)) {
      let persistentIdToFind = paddle.getData().wallPersistentId;
      let index = vertsSortedByVisualIndex.findIndex(([vert, _]) => vert.getData().persistentIndex === persistentIdToFind);
      if (index === -1) {
        console.warn('Expected to find vertex for paddle');
        continue;
      }
      let nextIndex = mod(index + 1, vertsSortedByVisualIndex.length);
      let wallStartVertPos = vertsSortedByVisualIndex[index][1].getData();
      let wallEndVertPos = vertsSortedByVisualIndex[nextIndex][1].getData();
      let posData = pos.getData();
      posData.lerpVectors(wallStartVertPos.clone(), wallEndVertPos.clone(), paddle.getData().positionInWallSpace);
      let wallDirection = wallEndVertPos.clone().sub(wallStartVertPos).normalize();
      orientation.getData().setFromAxisAngle(new THREE.Vector3(0, 0, 1), wallDirection.angle());
    }
  }
}
