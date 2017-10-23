import * as THREE from 'three';

import * as lk from 'laniakea-shared';

export function serializeVector3(stream: lk.SerializationStream, vector:THREE.Vector3) {
  stream.serializeFloat32(vector, 'x');
  stream.serializeFloat32(vector, 'y');
  stream.serializeFloat32(vector, 'z');
}

export class SerializableVector3 extends THREE.Vector3 implements lk.Serializable {
  serialize(stream: lk.SerializationStream): void {
    return serializeVector3(stream, this);
  }
}

export function serializeVector2(stream: lk.SerializationStream, vector:THREE.Vector2) {
  stream.serializeFloat32(vector, 'x');
  stream.serializeFloat32(vector, 'y');
}

export class SerializableVector2 extends THREE.Vector2 implements lk.Serializable {
  serialize(stream: lk.SerializationStream): void {
    return serializeVector2(stream, this);
  }
}

export class Position extends SerializableVector3 implements lk.Serializable {
}

export class Velocity extends SerializableVector3 implements lk.Serializable {
}

export function registerSharedComponents(engine: lk.Engine) {
  engine.registerComponentType(Position, 'Position' as lk.ComponentKind);
  engine.registerComponentType(Velocity, 'Velocity' as lk.ComponentKind);
}
