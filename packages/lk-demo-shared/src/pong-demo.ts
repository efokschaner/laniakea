// import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  registerSharedComponents as _registerSharedComponents,
  SerializableVector2,
} from './shared-components';


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

export class WallPosition implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    this.endA.serialize(stream);
    this.endB.serialize(stream);
    stream.serializeUint32(this, 'playerIndex');
  }
  public endA = new SerializableVector2();
  public endB = new SerializableVector2();
  public playerIndex = 0;
}

export class WallIndex implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeUint8(this, 'index');
  }
  public index = 0;
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

export function registerSharedComponents(engine: lk.Engine) {
  _registerSharedComponents(engine);
  engine.registerComponentType(PlayerInfo, 'PlayerInfo' as lk.ComponentKind);
  engine.registerComponentType(Paddle, 'Paddle' as lk.ComponentKind);
  engine.registerComponentType(WallPosition, 'WallPosition' as lk.ComponentKind);
  engine.registerComponentType(WallIndex, 'WallIndex' as lk.ComponentKind);
  engine.registerComponentType(WallVertex, 'WallVertex' as lk.ComponentKind);
}
