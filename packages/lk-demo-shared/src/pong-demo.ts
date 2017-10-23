import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import {
  Position,
  registerSharedComponents as _registerSharedComponents,
  SerializableVector2,
  Velocity
} from './shared-components';

/*
export class PlayerIndex implements lk.Serializable {
  serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'playerIndex');
  }
  playerIndex = 0;
}
*/

export class Paddle implements lk.Serializable {
  serialize(stream: lk.SerializationStream): void {
    stream.serializeUint32(this, 'wallId');
    stream.serializeFloat32(this, 'positionInWallSpace');
    stream.serializeFloat32(this, 'velocityInWallSpace');
  }
  wallId: lk.ComponentId = 0; // Which wall it's attached to
  // WallSpace is 1D interval (0 -> 1), from endA to endB of the wall
  positionInWallSpace = 0;
  velocityInWallSpace = 0;
}

export class WallPosition implements lk.Serializable {
  serialize(stream: lk.SerializationStream): void {
    this.endA.serialize(stream);
    this.endB.serialize(stream);
  }
  endA = new SerializableVector2();
  endB = new SerializableVector2();
}

export class WallIndex implements lk.Serializable {
  serialize(stream: lk.SerializationStream): void {
    stream.serializeUint8(this, 'index');
  }
  index = 0;
}


export function registerSharedComponents(engine: lk.Engine) {
  _registerSharedComponents(engine);
  engine.registerComponentType(Paddle, 'Paddle' as lk.ComponentKind);
  engine.registerComponentType(WallPosition, 'WallPosition' as lk.ComponentKind);
  engine.registerComponentType(WallIndex, 'WallIndex' as lk.ComponentKind);
}
