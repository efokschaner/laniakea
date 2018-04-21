import 'laniakea-server/dist/logger';

import * as lk from 'laniakea-server';

import {
  GameButtonsInput,
  gameServerWsPort,
  simFPS
} from 'lk-demo-pong-shared';

import { initialiseServer } from './pong-server';

const networkServer = new lk.NetworkServer(lk.INSECURE_AuthCallback);
let serverEngine = new lk.ServerEngine(
  networkServer,
  {
    simFPS: simFPS,
  },
);

serverEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');
initialiseServer(serverEngine);
serverEngine.start();
networkServer.listen(gameServerWsPort)
.then(() => {
  console.log('networkServer is listening.');
});
