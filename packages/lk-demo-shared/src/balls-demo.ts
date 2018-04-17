import boxIntersect = require('box-intersect');
import * as THREE from 'three';

import * as lk from 'laniakea-shared';

import { ButtonState, GameButtons, GameButtonsInput } from '.';
import {
  Position,
  registerSharedComponents,
  serializeVector3,
  Velocity,
} from './shared-components';

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

export function initialiseGame(engine: lk.Engine) {
  registerSharedComponents(engine);
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
    public Step({state, timeDeltaS}: {state: lk.EntityComponentState, timeDeltaS: number}) {
      for (let [position, velocity] of state.getAspect(Position, Velocity)!) {
        position.getData().add(velocity.getData().clone().multiplyScalar(timeDeltaS));
      }
    }
  }());
  // Update geometry from position
  engine.addSystem(new class implements lk.System {
    public Step({state, timeDeltaS}: {state: lk.EntityComponentState, timeDeltaS: number}) {
      for (let [ballposition, ballshape] of state.getAspect(Position, BallShape)!) {
        ballshape.getData().center.copy(ballposition.getData());
      }
    }
  }());
  // Collisions between balls and walls
  engine.addSystem(new class implements lk.System {
    private readonly coefficientOfRestitution = 1;
    public Step({state, timeDeltaS}: {state: lk.EntityComponentState, timeDeltaS: number}) {
      for (let [ball, ballvelocitycomp] of state.getAspect(BallShape, Velocity)!) {
        for (let wall of state.getComponents(WallPlane)!) {
          let wallPlane = wall.getData();
          let ballCenter = ball.getData().center;
          let vel = ballvelocitycomp.getData();
          let projectedPoint = wallPlane.projectPoint(ballCenter);
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
    public Step({state, timeDeltaS}: {state: lk.EntityComponentState, timeDeltaS: number}) {
      let balls = Array.from(state.getAspect(BallShape, Velocity)!);
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

export function initialiseLevel(state: lk.EntityComponentState) {
  let gridSideLength = 100;
  state.createEntity([new WallPlane(new THREE.Vector3(0, 1, 0), gridSideLength)]);
  state.createEntity([new WallPlane(new THREE.Vector3(0, -1, 0), gridSideLength)]);
  state.createEntity([new WallPlane(new THREE.Vector3(0, 0, 1), gridSideLength)]);
  state.createEntity([new WallPlane(new THREE.Vector3(0, 0, -1), gridSideLength)]);
  state.createEntity([new WallPlane(new THREE.Vector3(1, 0, 0), gridSideLength)]);
  state.createEntity([new WallPlane(new THREE.Vector3(-1, 0, 0), gridSideLength)]);

  let gridSideNumItems = 4;
  for (let i = 0; i < gridSideNumItems; ++i) {
    for (let j = 0; j < gridSideNumItems; ++j) {
      let x = ((i / gridSideNumItems) - 0.5) * gridSideLength;
      let z = ((j / gridSideNumItems) - 0.5) * gridSideLength;
      let velocityVal = 100;
      let velocity = new THREE.Vector3(
        THREE.Math.randFloatSpread(velocityVal),
        THREE.Math.randFloatSpread(velocityVal),
        THREE.Math.randFloatSpread(velocityVal));
      let pos = new THREE.Vector3(x, 0, z);
      state.createEntity([
        new Position(pos.x, pos.y, pos.z),
        new Velocity(velocity.x, velocity.y, velocity.z),
        new BallShape(pos, 16.0),
      ]);
    }
  }
}