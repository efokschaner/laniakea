import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  BallMovement,
  BallSpawner,
  BotSpawner,
  EntityScheduledDeletion,
  HumanPlayerId,
  MoveIntent,
  Orientation,
  Paddle,
  PlayerInfo,
  PolarLerp2D,
  Position2,
  WallVertex,
} from './components';

import { ButtonState, GameButtons, GameButtonsInput } from './inputs';
import { crossProduct2DBetweenWallAndPoint, WallData, wallPointsToWallData } from './wall-utils';

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

/**
 *  This lerps 2 vectors in in their polar space, this looks better for our geometrical layouts.
 */
export class PolarLerp2DProcessor implements lk.System {
  public Step({simulationTimeS, state}: lk.StepParams): void {
    for (let [position, lerp] of state.getAspect(Position2, PolarLerp2D)) {
      let lerpData = lerp.getData();
      let lerpFactor = (simulationTimeS - lerpData.startTimeS) / lerpData.durationS;
      if (lerpFactor < 0) {
        continue;
      }
      if (lerpFactor >= 1) {
        position.getData().copy(lerpData.targetPosition);
        lerp.delete();
        continue;
      }
      // Just for a bit of fun this is technically not a L(inear int)erp-olation anymore but whatever
      let smoothLerpFactor = THREE.Math.smoothstep(lerpFactor, 0, 1);

      let originalAngle = lerpData.originalPosition.angle();
      let targetAngle = lerpData.targetPosition.angle();
      let angleDelta = targetAngle - originalAngle;
      // Now make sure we don't take the "long" way round the circle
      if (angleDelta > Math.PI) {
        angleDelta = angleDelta - 2 * Math.PI;
      } else if (angleDelta < - Math.PI) {
        angleDelta = angleDelta + 2 * Math.PI;
      }
      let interpolatedAngle = originalAngle + smoothLerpFactor * angleDelta;
      let originalMagnitude = lerpData.originalPosition.length();
      let targetMagnitude = lerpData.targetPosition.length();
      let interpolatedMagnitude = originalMagnitude + smoothLerpFactor * (targetMagnitude - originalMagnitude);
      position.getData().set(interpolatedMagnitude * Math.cos(interpolatedAngle), interpolatedMagnitude * Math.sin(interpolatedAngle));
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

export class BallMovementSystem implements lk.System {

  // I'm not sure if allowing systems to know "isServer" would be considered "good practice",
  // but this approach doesn't impact the architecture so lets see how it works out here.
  constructor(private isServer: boolean) {
  }

  public Step({timeDeltaS, state, previousFrameState}: lk.StepParams): void {
    // For calculating collisions we want all wall vertices that existed on previous frame and this frame.
    let vertsToConsider = new Array<{prev: lk.Component<Position2>, next: lk.Component<Position2>, visualIndex: number, persistentIndex: number}>();
    for (let [prevVert, prevPos] of previousFrameState.getAspect(WallVertex, Position2)) {
      let maybeNextPos = state.getComponent(Position2, prevPos.getId());
      if (maybeNextPos !== undefined) {
        vertsToConsider.push({
          prev: prevPos,
          next: maybeNextPos,
          visualIndex: prevVert.getData().visualIndex,
          persistentIndex: prevVert.getData().persistentIndex,
        });
      }
    }
    let vertsToConsiderSorted = vertsToConsider.sort((a, b) => a.visualIndex - b.visualIndex);
    let walls = new Array<{prev: WallData, next: WallData, persistentIndex: number}>();
    for (let i = 0; i < vertsToConsiderSorted.length; ++i) {
      let startIndex = i;
      let endIndex = mod(i + 1, vertsToConsiderSorted.length);
      let startVerts = vertsToConsiderSorted[startIndex];
      let endVerts = vertsToConsiderSorted[endIndex];
      walls.push({
        prev: wallPointsToWallData(startVerts.prev.getData(), endVerts.prev.getData()),
        next: wallPointsToWallData(startVerts.next.getData(), endVerts.next.getData()),
        persistentIndex: startVerts.persistentIndex,
      });
    }

    // When walls get really short during interpolation, they can become zero length / swap directions.
    // This causes errors in our collision detection.
    // We filter any walls with length zero.
    // We also force the direction of all walls to be clockwise around the origin.
    walls = walls.filter((w) => {
      return w.next.wallLength !== 0 && w.prev.wallLength !== 0;
    });
    for (let wall of walls) {
      // if dot product of wallpoint with wall unit vec is positive, the wall is anticlockwise and we'll flip it.
      if (wall.prev.wallPoint.dot(wall.prev.wallUnitVec) > 0) {
        let originalStartPoint = wall.prev.wallPoint;
        wall.prev.wallPoint = wall.prev.wallEndPoint;
        wall.prev.wallEndPoint = originalStartPoint;
        wall.prev.wallUnitVec.negate();
      }
      if (wall.next.wallPoint.dot(wall.next.wallUnitVec) > 0) {
        let originalStartPoint = wall.next.wallPoint;
        wall.next.wallPoint = wall.next.wallEndPoint;
        wall.next.wallEndPoint = originalStartPoint;
        wall.next.wallUnitVec.negate();
      }
    }

    let persistentIndexToPaddle = new Map(
      Array.from(
        state.getComponents(Paddle),
      ).map(
        (p) => [p.getData().wallPersistentId, p] as [number, lk.Component<Paddle>],
      ),
    );

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
          // There's been a sign change, thus a collision to deal with
          let shouldReflect = true;
          // Determine if the paddle covered the point of intersection.
          // We wont interpolate to get the exact point of intersection as that's relatively brutal computationally.
          // We'll just use the latest frame as an approximation.
          let maybePaddle = persistentIndexToPaddle.get(wall.persistentIndex);
          // If there's no paddle theres no player to kill
          if (maybePaddle !== undefined) {
            let paddleData = maybePaddle.getData();
            let positionOfBallInWallspace = nextPos.clone().sub(wall.next.wallPoint).dot(wall.next.wallUnitVec) / wall.next.wallLength;
            let distanceBetweenPaddleAndBallInWallspace = Math.abs(paddleData.positionInWallSpace - positionOfBallInWallspace);
            // Paddle radius is half its length, plus a fudge factor to make the game a little more visually forgiving.
            let paddleRadiusInWallSpace = 0.55 * Paddle.lengthAsProportionOfWallLength;
            if (distanceBetweenPaddleAndBallInWallspace > paddleRadiusInWallSpace) {
              // Paddle did not intercept ball
              shouldReflect = false;
              // On server only, kill player and delete ball
              // Currently nothing we've done here is actually unsafe on the client. It seems prudent for if we add death stuff though.
              if (this.isServer) {
                let playerInfo = Array.from(state.getComponents(PlayerInfo)).find((pi) => pi.getData().playerIndex === paddleData.playerIndex)!;
                playerInfo.getData().alive = false;
                state.deleteEntity(ballMovement.getOwnerId());
              }
            }
          }
          if (shouldReflect) {
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
      let initialBallVelocityMagnitude = 4;
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

export class PaddleMovementSystem implements lk.System {
  public Step({state, timeDeltaS}: lk.StepParams): void {
    for (let paddle of state.getComponents(Paddle)) {
      let paddleData = paddle.getData();
      let maxMoveSpeed = 1.0;
      switch (paddleData.moveIntent) {
        case MoveIntent.NONE:
          if (paddleData.velocityInWallSpace > 0) {
            paddleData.velocityInWallSpace -= Paddle.maxAcceleration * timeDeltaS;
            paddleData.velocityInWallSpace = Math.max(paddleData.velocityInWallSpace, 0);
          } else if (paddleData.velocityInWallSpace < 0) {
            paddleData.velocityInWallSpace += Paddle.maxAcceleration * timeDeltaS;
            paddleData.velocityInWallSpace = Math.min(paddleData.velocityInWallSpace, 0);
          }
          break;
        case MoveIntent.NEGATIVE:
          paddleData.velocityInWallSpace -= Paddle.maxAcceleration * timeDeltaS;
          break;
        case MoveIntent.POSITIVE:
          paddleData.velocityInWallSpace += Paddle.maxAcceleration * timeDeltaS;
          break;
      }
      paddleData.velocityInWallSpace = THREE.Math.clamp(paddleData.velocityInWallSpace, -maxMoveSpeed, maxMoveSpeed);
      paddleData.positionInWallSpace = THREE.Math.clamp(
        paddleData.positionInWallSpace + paddleData.velocityInWallSpace * timeDeltaS,
        0.5 * Paddle.lengthAsProportionOfWallLength,
        1 - (0.5 * Paddle.lengthAsProportionOfWallLength));
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

function getOrCreateBotSpawner(state: lk.EntityComponentState): lk.Component<BotSpawner> {
  let spawners = Array.from(state.getComponents(BotSpawner));
  let spawner = spawners[0];
  if (spawner !== undefined) {
    return spawner;
  }
  let spawnerComponent = new BotSpawner();
  let newEntity = state.createEntity([spawnerComponent]);
  return newEntity.getComponent(BotSpawner)!;
}

export class BotSpawnerSystem implements lk.System {
  public Step({simulationTimeS, state}: lk.StepParams): void {
    let spawner = getOrCreateBotSpawner(state);
    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let numPlayersAlive = alivePlayers.length;
    let isTimeToSpawn = spawner.getData().lastBotSpawnTimeS <= simulationTimeS - 5;
    if (isTimeToSpawn && numPlayersAlive <= 20) {
      spawner.getData().lastBotSpawnTimeS = simulationTimeS;
      let newPlayerInfo = new PlayerInfo();
      newPlayerInfo.playerIndex = players.length + 1;
      state.createEntity([newPlayerInfo]);
    }
  }
}
