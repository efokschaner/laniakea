import 'laniakea-server/dist/logger';

import * as lk from 'laniakea-server';

import * as demo from 'lk-demo-pong-shared';

import * as ballsDemo from './balls-demo';
import * as pongDemo from './pong-demo';

const networkServer = new lk.NetworkServer(lk.INSECURE_AuthCallback);
let serverEngine = new lk.ServerEngine(
  networkServer,
  {
    simFPS: demo.simFPS,
  },
);

enum DemoType {
  BALLS,
  PONG,
}
let demoType = DemoType.PONG as DemoType;

switch (demoType) {
  case DemoType.BALLS:
    ballsDemo.initialiseServer(serverEngine);
    break;
  case DemoType.PONG:
    pongDemo.initialiseServer(serverEngine);
    break;
}

serverEngine.registerContinuousInputType(demo.GameButtonsInput, 'GameButtonsInput');

serverEngine.start();
networkServer.listen(demo.gameServerWsPort)
.then(() => {
  console.log('networkServer is listening.');
});
