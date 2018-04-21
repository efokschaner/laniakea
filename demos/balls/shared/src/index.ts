import boxIntersect = require('box-intersect');
import * as THREE from 'three';

import * as lk from 'laniakea-shared';

export const gameServerWsPort = 9876;
export function getGameServerWsUrl(hostname: string) { return `ws://${hostname}:${gameServerWsPort}`; }
export const simFPS = 20;

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

/**
 * Generates a class that provides binary "button"-style inputs as continuous input to the engine.
 * Knowledge of possible button inputs allows efficient serialization
 * @param buttonsEnum Either a TypeScript enum or an object of string keys to numeric values
 *                    that describes the button-style inputs you support in a keyboard-agnostic form.
 */
function createButtonsInputType(buttonsEnum: any) {
  return class implements lk.Serializable {
    public buttonStates = new Map<number, ButtonState>();
    constructor() {
      for (const button of getEnumValues(buttonsEnum)) {
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
        for (const button of getEnumValues(buttonsEnum)) {
          if (downButtons.has(button)) {
            this.buttonStates.set(button, ButtonState.DOWN);
          } else {
            this.buttonStates.set(button, ButtonState.UP);
          }
        }
      }
    }
  };
}

export enum GameButtons { UP, DOWN }

// This variable is a dynamic Class
// tslint:disable-next-line:variable-name
export let GameButtonsInput = createButtonsInputType(GameButtons);

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

export class Position extends SerializableVector3 implements lk.Serializable {
}

export class Velocity extends SerializableVector3 implements lk.Serializable {
}

export class WallPlane extends THREE.Plane implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    stream.serializeFloat32(this, 'constant');
    serializeVector3(stream, this.normal);
  }
}

export class BallShape extends THREE.Sphere implements lk.Serializable {
  public serialize(stream: lk.SerializationStream): void {
    serializeVector3(stream, this.center);
    stream.serializeFloat32(this, 'radius');
  }
}

export function initialiseEngine(engine: lk.Engine) {
  engine.registerComponentType(Position, 'Position' as lk.ComponentKind);
  engine.registerComponentType(Velocity, 'Velocity' as lk.ComponentKind);
  engine.registerComponentType(WallPlane, 'WallPlane' as lk.ComponentKind);
  engine.registerComponentType(BallShape, 'BallShape' as lk.ComponentKind);
  // Apply gravity
  /*
  engine.addSystem(new class implements lk.System {
    private readonly GEE = new THREE.Vector3(0,-9.8,0);
    Step({state, timeDeltaS}: {state: lk.EntityComponentState, timeDeltaS: number}) {
      for(let velocity of state.getComponents(Velocity)!) {
        velocity.getData().add(this.GEE.clone().multiplyScalar(timeDeltaS));
      }
    }
  });
  */
  // Add viscosity
  /*engine.addSystem(new class implements lk.System {
    Step({state, timeDeltaS}: {state: lk.EntityComponentState, timeDeltaS: number}) {
      for(let velocity of state.getComponents(Velocity)!) {
        velocity.getData().multiplyScalar(0.999);
      }
    }
  });*/
  // Apply movement control to walls
  engine.addSystem(new class implements lk.System {
    public Step({state, timeDeltaS, inputs}: lk.StepParams) {
      let anyDown = false;
      let anyUp = false;
      for (let input of inputs.values()) {
        let buttonsInput = input.getContinuousInput(GameButtonsInput)!;
        if (buttonsInput.buttonStates.get(GameButtons.DOWN) === ButtonState.DOWN) {
          anyDown = true;
        }
        if (buttonsInput.buttonStates.get(GameButtons.UP) === ButtonState.DOWN) {
          anyUp = true;
        }
      }
      for (let wall of state.getComponents(WallPlane)!) {
        let wallPlane = wall.getData();
        if (anyDown) {
          wallPlane.constant -= timeDeltaS * 6;
        } else if (anyUp) {
          wallPlane.constant += timeDeltaS * 6;
        }
      }
    }
  }());

  // integrate velocity
  engine.addSystem(new class implements lk.System {
    public Step({state, timeDeltaS}: lk.StepParams) {
      for (let [position, velocity] of state.getAspect(Position, Velocity)) {
        position.getData().add(velocity.getData().clone().multiplyScalar(timeDeltaS));
      }
    }
  }());
  // Update geometry from position
  engine.addSystem(new class implements lk.System {
    public Step({state, timeDeltaS}: lk.StepParams) {
      for (let [ballposition, ballshape] of state.getAspect(Position, BallShape)) {
        ballshape.getData().center.copy(ballposition.getData());
      }
    }
  }());
  // Collisions between balls and walls
  engine.addSystem(new class implements lk.System {
    private readonly coefficientOfRestitution = 1;
    public Step({state, timeDeltaS}: lk.StepParams) {
      for (let [ball, ballvelocitycomp] of state.getAspect(BallShape, Velocity)) {
        for (let wall of state.getComponents(WallPlane)!) {
          let wallPlane = wall.getData();
          let ballCenter = ball.getData().center;
          let vel = ballvelocitycomp.getData();
          let projectedPoint = wallPlane.projectPoint(ballCenter, new THREE.Vector3());
          let planeToBall = ballCenter.clone().sub(projectedPoint);
          if (planeToBall.dot(wallPlane.normal) < ball.getData().radius && vel.dot(wallPlane.normal) < 0) {
            ballCenter.copy(projectedPoint.add(wallPlane.normal.clone().multiplyScalar(ball.getData().radius)));
            vel.sub(wallPlane.normal.clone().multiplyScalar((1 + this.coefficientOfRestitution) * vel.dot(wallPlane.normal)));
          }
        }
      }
    }
  }());
  // Collisions between balls and balls
  engine.addSystem(new class implements lk.System {
    public Step({state, timeDeltaS}: lk.StepParams) {
      let balls = Array.from(state.getAspect(BallShape, Velocity));
      let curBoundingBox = new THREE.Box3();
      let aabbs = balls.map(([ball, ballvelocitycomp]) => {
        ball.getData().getBoundingBox(curBoundingBox);
        return curBoundingBox.min.toArray().concat(curBoundingBox.max.toArray());
      });
      boxIntersect(aabbs, (i, j) => {
        let [ballIShape, ballIVel] = balls[i];
        let [ballJShape, ballJVel] = balls[j];
        let jPosRelativeToI = ballJShape.getData().center.clone().sub(ballIShape.getData().center);
        // aabb is looser than this real collision test
        if (jPosRelativeToI.length() > ballIShape.getData().radius + ballJShape.getData().radius) {
          return;
        }

        let jVelRelativeToI = ballJVel.getData().clone().sub(ballIVel.getData());
        let objectsAreApproaching = jPosRelativeToI.dot(jVelRelativeToI) < 0;
        if (!objectsAreApproaching) {
          return;
        }
        let iPosRelativeToJ = jPosRelativeToI.clone().negate();
        let iVelRelativeToJ = jVelRelativeToI.clone().negate();
        let separationSquared = iPosRelativeToJ.lengthSq();
        ballIVel.getData().sub(iPosRelativeToJ.multiplyScalar(iVelRelativeToJ.dot(iPosRelativeToJ) / separationSquared));
        ballJVel.getData().sub(jPosRelativeToI.multiplyScalar(jVelRelativeToI.dot(jPosRelativeToI) / separationSquared));
      });
    }
  }());
}
