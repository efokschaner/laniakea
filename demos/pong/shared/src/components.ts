import * as THREE from 'three';

import * as lk from 'laniakea-shared';

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
  public playerId = 0 as lk.PlayerId;
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
  public wallPersistentId: number = 0; // Which wall it's attached to
  // WallSpace is 1D interval (0 -> 1), from endA to endB of the wall
  public positionInWallSpace = 0.5;
  public velocityInWallSpace = 0;
  public moveIntent = MoveIntent.NONE;

  public static maxAcceleration = 5.0;
  public static lengthAsProportionOfWallLength = 0.1;
}

export class WallVertex implements lk.Serializable {
  public visualIndex = 0;
  public persistentIndex = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'visualIndex');
    stream.serializeInt32(this, 'persistentIndex');
  }
}

export class PolarLerp2D implements lk.Serializable {
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

export class EntityScheduledDeletion implements lk.Serializable {
  public deletionTimeS = 0;

  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'deletionTimeS');
  }
}

export class BallMovement implements lk.Serializable {
  public velocity = new SerializableVector2();

  public serialize(stream: lk.SerializationStream): void {
    this.velocity.serialize(stream);
  }
}

export class BallSpawner implements lk.Serializable {
  public lastBallSpawnTimeS = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeFloat64(this, 'lastBallSpawnTimeS');
  }
}

export class Final2Players implements lk.Serializable {
  public finalPlayerIndexA = 1;
  public finalPlayerIndexB = 2;

  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'finalPlayerIndexA');
    stream.serializeUint32(this, 'finalPlayerIndexB');
  }
}

export class BotSpawner implements lk.Serializable {
  public lastBotSpawnTimeS = 0;
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeFloat64(this, 'lastBotSpawnTimeS');
  }
}

export function registerComponents(engine: lk.Engine) {
  engine.registerComponentType(Position2, 'Position2');
  engine.registerComponentType(Orientation, 'Orientation');
  engine.registerComponentType(PlayerInfo, 'PlayerInfo');
  engine.registerComponentType(HumanPlayerId, 'HumanPlayerId');
  engine.registerComponentType(Paddle, 'Paddle');
  engine.registerComponentType(WallVertex, 'WallVertex');
  engine.registerComponentType(PolarLerp2D, 'PolarLerp2D');
  engine.registerComponentType(EntityScheduledDeletion, 'EntityScheduledDeletion');
  engine.registerComponentType(BallMovement, 'BallMovement');
  engine.registerComponentType(BallSpawner, 'BallSpawner');
  engine.registerComponentType(Final2Players, 'Final2Players');
  engine.registerComponentType(BotSpawner, 'BotSpawner');
}
