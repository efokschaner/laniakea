import * as THREE from 'three';

import * as lk from 'laniakea-shared';

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}`; }
export const simFPS = 20;

// Because JS's % operator returns negative values
// for modulus of negative numbers,
// which we don't want.
function mod(n: number, m: number) {
  return ((n % m) + m) % m;
}

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

export function serializeVector3(stream: lk.SerializationStream, vector: THREE.Vector3) {
  stream.serializeFloat32(vector, 'x');
  stream.serializeFloat32(vector, 'y');
  stream.serializeFloat32(vector, 'z');
}

export class SerializableVector3 extends THREE.Vector3 implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    return serializeVector3(stream, this);
  }
}

export function serializeVector2(stream: lk.SerializationStream, vector: THREE.Vector2) {
  stream.serializeFloat32(vector, 'x');
  stream.serializeFloat32(vector, 'y');
}

export class SerializableVector2 extends THREE.Vector2 implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    return serializeVector2(stream, this);
  }
}

// TODO Orientation quaternions have redundancy as they must be length 1 and so we can use this
// to reduce the data we need to send.
export function serializeQuaternion(stream: lk.SerializationStream, q: THREE.Quaternion) {
  stream.serializeFloat32(q, 'x');
  stream.serializeFloat32(q, 'y');
  stream.serializeFloat32(q, 'z');
  stream.serializeFloat32(q, 'w');
}

export class SerializableQuaternion extends THREE.Quaternion implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    return serializeQuaternion(stream, this);
  }
}

export class Position2 extends SerializableVector2 implements lk.Serializable {
}

export class Orientation extends SerializableQuaternion implements lk.Serializable {
}

export class PlayerInfo implements lk.Serializable {
  public playerIndex = 0;
  public alive = true;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'playerIndex');
    stream.serializeBoolean(this, 'alive');
  }
}

export class HumanPlayerId implements lk.Serializable {
  public playerId: lk.PlayerId = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'playerId');
  }
}

export enum MoveIntent { NONE, NEGATIVE, POSITIVE }

export class Paddle implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'playerIndex');
    stream.serializeUint32(this, 'wallPersistentId');
    stream.serializeFloat32(this, 'positionInWallSpace');
    stream.serializeFloat32(this, 'velocityInWallSpace');
    stream.serializeUint8(this, 'moveIntent');
  }
  public playerIndex: number = 0;
  public wallPersistentId: lk.ComponentId = 0; // Which wall it's attached to
  // WallSpace is 1D interval (0 -> 1), from endA to endB of the wall
  public positionInWallSpace = 0.5;
  public velocityInWallSpace = 0;
  public moveIntent = MoveIntent.NONE;
}

export class WallVertex implements lk.Serializable {
  public visualIndex = 0;
  public persistentIndex = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'visualIndex');
    stream.serializeUint32(this, 'persistentIndex');
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

export class EntityScheduledDeletion implements lk.Serializable {
  public deletionTimeS = 0;

  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'deletionTimeS');
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

export class BallSpawner implements lk.Serializable {
  public lastBallSpawnTimeS = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeFloat64(this, 'lastBallSpawnTimeS');
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

export class PaddleMovementSystem implements lk.System {
  public Step({state, timeDeltaS}: lk.StepParams): void {
    for (let paddle of state.getComponents(Paddle)) {
      let paddleData = paddle.getData();
      // TODO consider an accelerative approach
      let maxMoveSpeed = 0.4;
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
      paddleData.positionInWallSpace = THREE.Math.clamp(paddleData.positionInWallSpace + paddleData.velocityInWallSpace * timeDeltaS, 0, 1);
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

export function registerComponents(engine: lk.Engine) {
  engine.registerComponentType(Position2, 'Position2' as lk.ComponentKind);
  engine.registerComponentType(Orientation, 'Orientation' as lk.ComponentKind);
  engine.registerComponentType(PlayerInfo, 'PlayerInfo' as lk.ComponentKind);
  engine.registerComponentType(HumanPlayerId, 'HumanPlayerId' as lk.ComponentKind);
  engine.registerComponentType(Paddle, 'Paddle' as lk.ComponentKind);
  engine.registerComponentType(WallVertex, 'WallVertex' as lk.ComponentKind);
  engine.registerComponentType(Lerp2D, 'Lerp2D' as lk.ComponentKind);
  engine.registerComponentType(EntityScheduledDeletion, 'EntityScheduledDeletion' as lk.ComponentKind);
  engine.registerComponentType(BallMovement, 'BallMovement' as lk.ComponentKind);
  engine.registerComponentType(BallSpawner, 'BallSpawner' as lk.ComponentKind);
}
