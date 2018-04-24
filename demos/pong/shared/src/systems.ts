import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  BallMovement,
  BallSpawner,
  BotSpawner,
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
  wallEndPoint: THREE.Vector2;
  wallUnitVec: THREE.Vector2;
  wallLength: number;
}

function wallPointsToWallData(pointA: THREE.Vector2, pointB: THREE.Vector2): WallData {
  let wallVec = pointB.clone().sub(pointA);
  let wallLength = wallVec.length();
  let wallUnitVec = wallVec.normalize();
  return {
    wallPoint: pointA,
    wallEndPoint: pointB,
    wallUnitVec,
    wallLength,
  };
}

function crossProduct2DBetweenWallAndPoint(wallData: WallData, point: THREE.Vector2) {
  let wallPointToPoint = point.clone().sub(wallData.wallPoint);
  return (wallPointToPoint.x * wallData.wallUnitVec.y) - (wallPointToPoint.y * wallData.wallUnitVec.x);
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
            let paddleRadiusInWallSpace = 0.55 * paddleLengthAsProportionOfWallLength;
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

export let paddleLengthAsProportionOfWallLength = 0.1;
let paddleAcceleration = 5.0;
export class PaddleMovementSystem implements lk.System {
  public Step({state, timeDeltaS}: lk.StepParams): void {
    for (let paddle of state.getComponents(Paddle)) {
      let paddleData = paddle.getData();
      let maxMoveSpeed = 1.0;
      switch (paddleData.moveIntent) {
        case MoveIntent.NONE:
          if (paddleData.velocityInWallSpace > 0) {
            paddleData.velocityInWallSpace -= paddleAcceleration * timeDeltaS;
            paddleData.velocityInWallSpace = Math.max(paddleData.velocityInWallSpace, 0);
          } else if (paddleData.velocityInWallSpace < 0) {
            paddleData.velocityInWallSpace += paddleAcceleration * timeDeltaS;
            paddleData.velocityInWallSpace = Math.min(paddleData.velocityInWallSpace, 0);
          }
          break;
        case MoveIntent.NEGATIVE:
          paddleData.velocityInWallSpace -= paddleAcceleration * timeDeltaS;
          break;
        case MoveIntent.POSITIVE:
          paddleData.velocityInWallSpace += paddleAcceleration * timeDeltaS;
          break;
      }
      paddleData.velocityInWallSpace = THREE.Math.clamp(paddleData.velocityInWallSpace, -maxMoveSpeed, maxMoveSpeed);
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

export class BotLogic implements lk.System {
  public Step({state}: lk.StepParams): void {
    let playerIndexToPaddleMap = new Map(
      Array.from(
        state.getComponents(Paddle),
      ).map(
        (paddle) => [paddle.getData().playerIndex, paddle.getData()] as [number, Paddle],
      ),
    );

    let vertsToConsider = Array.from(state.getAspect(WallVertex, Position2));
    let vertsToConsiderSorted = vertsToConsider.sort((a, b) => a[0].getData().visualIndex - b[0].getData().visualIndex);
    let persistentIndexToWallData = new Map<number, WallData>();
    for (let i = 0; i < vertsToConsiderSorted.length; ++i) {
      let startIndex = i;
      let endIndex = mod(i + 1, vertsToConsiderSorted.length);
      let startVert = vertsToConsiderSorted[startIndex];
      let endVert = vertsToConsiderSorted[endIndex];
      persistentIndexToWallData.set(
        startVert[0].getData().persistentIndex,
        wallPointsToWallData(startVert[1].getData(), endVert[1].getData()),
      );
    }

    let balls = Array.from(state.getAspect(BallMovement, Position2));

    // All players with no human player ID are implicitly bots.
    for (let playerInfo of state.getComponents(PlayerInfo)) {
      let playerInfoData = playerInfo.getData();
      if (!playerInfoData.alive) {
        // Dead, ignore
        continue;
      }
      let maybeHumanId = state.getComponentOfEntity(HumanPlayerId, playerInfo.getOwnerId());
      if (maybeHumanId !== undefined) {
        // Not a bot
        continue;
      }
      let paddle = playerIndexToPaddleMap.get(playerInfoData.playerIndex)!;
      let ourWall = persistentIndexToWallData.get(paddle.wallPersistentId)!;
      // Find nearest ball with net velocity in direction of our wall
      // Intersect ball velocity with wall line, move to that point.
      // If no balls match, move to centre.
      let desiredWallPosInWallSpace = 0.5;
      let wallLine = new THREE.Line3(
        new THREE.Vector3(ourWall.wallPoint.x, ourWall.wallPoint.y),
        new THREE.Vector3(ourWall.wallEndPoint.x, ourWall.wallEndPoint.y),
      );
      let nearestBallDistance: number = Infinity;
      for (let ballComponents of balls) {
        let ballPosition = ballComponents[1].getData();
        let ballVelocity = ballComponents[0].getData().velocity;
        let ballPos3D = new THREE.Vector3(ballPosition.x, ballPosition.y);
        let closestPointOnWall = wallLine.closestPointToPoint(
          new THREE.Vector3(ballPosition.x, ballPosition.y),
          true,
          new THREE.Vector3(),
        );
        // is ball moving in direction of nearest point?
        let closestPointOnWall2D = new THREE.Vector2(closestPointOnWall.x, closestPointOnWall.y);
        let isMovingTowardsWall = closestPointOnWall2D.sub(ballPosition).dot(ballVelocity) > 0;
        if (!isMovingTowardsWall) {
          // Ignore this ball
          continue;
        }
        let distanceToWall = closestPointOnWall.distanceTo(ballPos3D);
        if (nearestBallDistance > distanceToWall) {
          nearestBallDistance = distanceToWall;
          let normalizedBallVelocity = ballVelocity.clone().normalize();
          let ballRay = new THREE.Ray(
            new THREE.Vector3(ballPosition.x, ballPosition.y),
            new THREE.Vector3(normalizedBallVelocity.x, normalizedBallVelocity.y));
          let intersectOfWallWithBall = new THREE.Vector3();
          ballRay.distanceSqToSegment(wallLine.start, wallLine.end, intersectOfWallWithBall);
          desiredWallPosInWallSpace = wallLine.closestPointToPointParameter(intersectOfWallWithBall, true);
        }
      }
      // Bot's prediction of where it will be if it stops moving now
      let predictedPositionOfRest = paddle.positionInWallSpace;
      if (paddle.velocityInWallSpace !== 0) {
        let paddleAccelerationIfWeStopMoving = - Math.sign(paddle.velocityInWallSpace) * paddleAcceleration;
        let timeToRest = - paddle.velocityInWallSpace / paddleAccelerationIfWeStopMoving;
        predictedPositionOfRest += paddle.velocityInWallSpace * timeToRest + 0.5 * paddleAccelerationIfWeStopMoving * (timeToRest ** 2);
      }
      let deadZoneProportion = paddleLengthAsProportionOfWallLength / 4;
      if (predictedPositionOfRest > (1 + deadZoneProportion) * desiredWallPosInWallSpace) {
        paddle.moveIntent = MoveIntent.NEGATIVE;
      } else if (predictedPositionOfRest < (1 - deadZoneProportion) * desiredWallPosInWallSpace) {
        paddle.moveIntent = MoveIntent.POSITIVE;
      } else {
        paddle.moveIntent = MoveIntent.NONE;
      }
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
    let isTimeToSpawn = spawner.getData().lastBotSpawnTimeS <= simulationTimeS - 10;
    if (isTimeToSpawn && numPlayersAlive <= 4) {
      spawner.getData().lastBotSpawnTimeS = simulationTimeS;
      let newPlayerInfo = new PlayerInfo();
      newPlayerInfo.playerIndex = players.length;
      state.createEntity([newPlayerInfo]);
    }
  }
}
