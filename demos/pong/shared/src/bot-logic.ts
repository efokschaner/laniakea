import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  BallMovement,
  HumanPlayerId,
  MoveIntent,
  Paddle,
  PlayerInfo,
  Position2,
  WallVertex,
} from './components';
import { WallData, wallPointsToWallData } from './wall-utils';

/**
 * modulo which produces positive values for negative numbers.
 * JS's % operator returns negative values for modulus of negative numbers, which we don't want.
 */
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

export function getPersistentIndexToWallDataMap(state: lk.EntityComponentState): Map<number, WallData> {
  let vertsToConsider = Array.from(state.getAspect(WallVertex, Position2));
  let vertsToConsiderSorted = vertsToConsider.sort((a, b) => a[0].getData().visualIndex - b[0].getData().visualIndex);
  let persistentIndexToWallData = new Map<number, WallData>();
  for (let i = 0; i < vertsToConsiderSorted.length; ++i) {
    let startIndex = i;
    let endIndex = mod(i + 1, vertsToConsiderSorted.length);
    let startVert = vertsToConsiderSorted[startIndex];
    let endVert = vertsToConsiderSorted[endIndex];
    persistentIndexToWallData.set(startVert[0].getData().persistentIndex, wallPointsToWallData(startVert[1].getData(), endVert[1].getData()));
  }
  return persistentIndexToWallData;
}

/*
 * Calculate the best action for the given paddle on the given wall accounting for all the given balls
 */
export function calculateBestMoveIntent(paddle: Paddle, wallData: WallData, balls: ReadonlyArray<[lk.Component<BallMovement>, lk.Component<Position2>]>) {
  // Find nearest ball with net velocity in direction of our wall
  // Intersect ball velocity with wall line, move to that point.
  // If no balls match, we find the nearest ball and defend against that
  // this is to cope with nearby balls that could get deflected to us
  // by another player.
  let desiredWallPosInWallSpace = 0.5;
  let wallLine = new THREE.Line3(
    new THREE.Vector3(wallData.wallPoint.x, wallData.wallPoint.y),
    new THREE.Vector3(wallData.wallEndPoint.x, wallData.wallEndPoint.y),
  );
  let considerBallsNotMovingAtUs = true;
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
    let distanceToWall = closestPointOnWall.distanceTo(ballPos3D);
    if (distanceToWall > wallLine.distance() / 4) {
      // ignore balls further than 1/4 a side length away.
      continue;
    }
    let isMovingTowardsWall = closestPointOnWall2D.sub(ballPosition).dot(ballVelocity) > 0;
    if (!isMovingTowardsWall) {
      if (considerBallsNotMovingAtUs) {
        // We havent yet found a ball moving at us so we might as well try to guard against this one.
        desiredWallPosInWallSpace = wallLine.closestPointToPointParameter(closestPointOnWall, true);
      }
      // Finished considering this ball
      continue;
    }
    considerBallsNotMovingAtUs = false;
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
    let paddleAccelerationIfWeStopMoving = - Math.sign(paddle.velocityInWallSpace) * Paddle.maxAcceleration;
    let timeToRest = - paddle.velocityInWallSpace / paddleAccelerationIfWeStopMoving;
    predictedPositionOfRest += paddle.velocityInWallSpace * timeToRest + 0.5 * paddleAccelerationIfWeStopMoving * (timeToRest ** 2);
  }
  let deadZoneProportion = Paddle.lengthAsProportionOfWallLength / 4;
  if (predictedPositionOfRest > (1 + deadZoneProportion) * desiredWallPosInWallSpace) {
    return MoveIntent.NEGATIVE;
  } else if (predictedPositionOfRest < (1 - deadZoneProportion) * desiredWallPosInWallSpace) {
    return MoveIntent.POSITIVE;
  } else {
    return MoveIntent.NONE;
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
    let persistentIndexToWallData = getPersistentIndexToWallDataMap(state);
    let balls = Array.from(state.getAspect(BallMovement, Position2));
    for (let playerInfo of state.getComponents(PlayerInfo)) {
      let playerInfoData = playerInfo.getData();
      if (!playerInfoData.alive) {
        // Dead, ignore
        continue;
      }
      // All players with no human player ID are implicitly bots.
      let maybeHumanId = playerInfo.getOwner().getComponent(HumanPlayerId);
      if (maybeHumanId !== undefined) {
        // Not a bot
        continue;
      }
      let paddle = playerIndexToPaddleMap.get(playerInfoData.playerIndex)!;
      if (paddle === undefined) {
        // player does not have paddle yet, or maybe just got deleted
        continue;
      }
      let wall = persistentIndexToWallData.get(paddle.wallPersistentId)!;
      paddle.moveIntent = calculateBestMoveIntent(paddle, wall, balls);
    }
  }
}
