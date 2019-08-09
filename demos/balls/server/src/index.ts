import * as THREE from 'three';

import * as lk from 'laniakea-server';
lk.hookConsoleWithLogger();

import {
  BallShape,
  GameButtonsInput,
  gameServerWsPort,
  initialiseEngine,
  Position,
  simFPS,
  Velocity,
  WallPlane,
} from 'lk-demo-balls-shared';

function initialiseLevel(state: lk.EntityComponentState) {
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

const networkServer = new lk.NetworkServer(lk.INSECURE_AuthCallback);
let serverEngine = new lk.ServerEngine(
  networkServer,
  {
    simFPS,
  },
);

initialiseEngine(serverEngine.engine);
initialiseLevel(serverEngine.currentFrame.state);

serverEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');

serverEngine.start();
networkServer.listen({
  signalingWebsocketServerPort: gameServerWsPort,
  webrtcPeerConnectionPortRange: { min: 11214, max: 11214 }
})
.then(() => {
  console.log('networkServer is listening.');
});
