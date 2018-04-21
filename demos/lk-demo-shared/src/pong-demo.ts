import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  Position2,
  registerSharedComponents as _registerSharedComponents,
  SerializableVector2
} from './shared-components';

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

export class PlayerInfo implements lk.Serializable {
  public playerId = 0;
  public playerIndex = 0;
  public alive = true;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'playerId');
    stream.serializeUint32(this, 'playerIndex');
    stream.serializeBoolean(this, 'alive');
  }
}

export enum MoveIntent { NONE, NEGATIVE, POSITIVE };

export class Paddle implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'wallId');
    stream.serializeFloat32(this, 'positionInWallSpace');
    stream.serializeFloat32(this, 'velocityInWallSpace');
    stream.serializeUint8(this, 'moveIntent');
  }
  public wallId: lk.ComponentId = 0; // Which wall it's attached to
  // WallSpace is 1D interval (0 -> 1), from endA to endB of the wall
  public positionInWallSpace = 0;
  public velocityInWallSpace = 0;
  public moveIntent = MoveIntent.NONE;
}

export class PaddleAiTag implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
  }
}

export class WallVertex implements lk.Serializable {
  public visualIndex = 0;
  public persistentIndex = 0;
  public position = new SerializableVector2();
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'visualIndex');
    stream.serializeUint32(this, 'persistentIndex');
    this.position.serialize(stream);
  }
}

export class Lerp2D implements lk.Serializable {
  public originalPosition = new SerializableVector2();
  public targetPosition = new SerializableVector2();
  public startTimeS = 0;
  public durationS = 0;

  public serialize(stream: lk.SerializationStream): void {
    this.originalPosition.serialize(stream);
    this.targetPosition.serialize(stream);
    stream.serializeUint32(this, 'startTimeS');
    stream.serializeUint32(this, 'durationS');
  }
}

export class Lerp2DProcessor implements lk.System {
  Step({simulationTimeS, state}: {simulationTimeS: number, state: lk.EntityComponentState}): void {
    for(let [vertex, lerp] of state.getAspect(WallVertex, Lerp2D)!) {
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
      vertex.getData().position.lerpVectors(lerpData.originalPosition, lerpData.targetPosition, lerpFactor);
    }
  }
}

export class EntityScheduledDeletion implements lk.Serializable {
  public deletionTimeS = 0;

  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'deletionTimeS');
  }
}

export class EntityScheduledDeletionProcessor implements lk.System {
  Step({simulationTimeS, state}: {simulationTimeS: number, state: lk.EntityComponentState}): void {
    for(let schedule of state.getComponents(EntityScheduledDeletion)!) {
      let scheduleData = schedule.getData();
      if(scheduleData.deletionTimeS <= simulationTimeS) {
        state.deleteEntity(schedule.getOwnerId());
      }
    }
  }
}

export class BallMovement implements lk.Serializable {
  public velocity = new SerializableVector2();

  public serialize(stream: lk.SerializationStream): void {
    this.velocity.serialize(stream);
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
    wallUnitVec: wallUnitVec
  };
}
function crossProduct2DBetweenWallAndPoint(wallData: WallData, point: THREE.Vector2) {
  let wallPointToPoint = point.clone().sub(wallData.wallPoint);
  return (wallPointToPoint.x * wallData.wallUnitVec.y) - (wallPointToPoint.y * wallData.wallUnitVec.x);
}

export class BallMovementSystem implements lk.System {
  Step({timeDeltaS, state, previousFrameState}: {timeDeltaS: number, state: lk.EntityComponentState, previousFrameState: lk.EntityComponentState}): void {
    // For calculating collisions we want all wall vertices that existed on previous frame and this frame.
    let vertsToConsider = new Array<{prev: lk.Component<WallVertex>, next: lk.Component<WallVertex>}>();
    for(let prevVert of previousFrameState.getComponents(WallVertex)) {
      let maybeNextVert = state.getComponent(WallVertex, prevVert.getId());
      if (maybeNextVert !== undefined) {
        vertsToConsider.push({prev: prevVert, next: maybeNextVert});
      }
    }
    let vertsToConsiderSorted = vertsToConsider.sort((a, b) => a.prev.getData().visualIndex - b.prev.getData().visualIndex);
    let walls = new Array<{prev:WallData, next: WallData}>();
    for(let i = 0; i < vertsToConsiderSorted.length; ++i) {
      let startIndex = i;
      let endIndex = mod(i+1, vertsToConsiderSorted.length)
      let startVerts = vertsToConsiderSorted[startIndex];
      let endVerts = vertsToConsiderSorted[endIndex];
      walls.push({
        prev: wallPointsToWallData(startVerts.prev.getData().position, endVerts.prev.getData().position),
        next: wallPointsToWallData(startVerts.next.getData().position, endVerts.next.getData().position)
      });
    }

    for(let [ballPosition, ballMovement] of state.getAspect(Position2, BallMovement)!) {
      let ballMovementData = ballMovement.getData();
      let prevPos = ballPosition.getData().clone();
      let nextPos = ballPosition.getData().addScaledVector(ballMovementData.velocity, timeDeltaS);
      // Calculate collisions by checking sign change in outer product with wall on previous frame and next
      for(let wall of walls) {
        let prevProduct = crossProduct2DBetweenWallAndPoint(wall.prev, prevPos);
        let nextProduct = crossProduct2DBetweenWallAndPoint(wall.next, nextPos);
        // We only care about collisions with the ball going outwards (to prevent numerical issue with the ball getting stuck outside the shape)
        if(prevProduct > 0 && nextProduct <= 0) {
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

export class BallSpawner implements lk.Serializable {
  public lastBallSpawnTimeS = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeFloat64(this, 'lastBallSpawnTimeS');
  }
}

function getOrCreateBallSpawner(state: lk.EntityComponentState): lk.Component<BallSpawner> {
  let spawners = Array.from(state.getComponents(BallSpawner));
  let spawner = spawners[0];
  if(spawner !== undefined) {
    return spawner;
  }
  let spawnerComponent = new BallSpawner();
  let newEntity = state.createEntity([spawnerComponent]);
  return newEntity.getComponent(BallSpawner)!;
}

export class BallSpawnerSystem implements lk.System {
  Step({simulationTimeS, state}: {simulationTimeS: number, state: lk.EntityComponentState}): void {
    let spawner = getOrCreateBallSpawner(state);
    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let balls = Array.from(state.getComponents(BallMovement));
    let desiredNumBalls = Math.floor(alivePlayers.length / 2);
    let hasBeenMoreThanASecondSinceLastSpawn = spawner.getData().lastBallSpawnTimeS <= simulationTimeS - 1;
    if(hasBeenMoreThanASecondSinceLastSpawn && balls.length < desiredNumBalls) {
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


export function registerSharedComponents(engine: lk.Engine) {
  _registerSharedComponents(engine);
  engine.registerComponentType(PlayerInfo, 'PlayerInfo' as lk.ComponentKind);
  engine.registerComponentType(Paddle, 'Paddle' as lk.ComponentKind);
  engine.registerComponentType(WallVertex, 'WallVertex' as lk.ComponentKind);
  engine.registerComponentType(Lerp2D, 'Lerp2D' as lk.ComponentKind);
  engine.registerComponentType(EntityScheduledDeletion, 'EntityScheduledDeletion' as lk.ComponentKind);
  engine.registerComponentType(BallMovement, 'BallMovement' as lk.ComponentKind);
  engine.registerComponentType(BallSpawner, 'BallSpawner' as lk.ComponentKind);
}
