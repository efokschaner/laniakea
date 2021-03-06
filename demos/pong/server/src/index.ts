import * as lk from '@laniakea/server-engine';
lk.hookConsoleWithLogger();

import {
  GameButtonsInput,
  gameServerWsPort,
  globalSimulationRateMultiplier,
  simFPS,
} from 'lk-demo-pong-shared';

import { initialiseServer } from './pong-server';

let serverEngine = new lk.ServerEngine(lk.INSECURE_AuthCallback, {
  simFPS,
  globalSimulationRateMultiplier,
});

serverEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');
initialiseServer(serverEngine);
serverEngine.start();
void serverEngine
  .listen({
    signalingWebsocketServerPort: gameServerWsPort,
    webrtcPeerConnectionPortRange: { min: 11213, max: 11213 },
  })
  .then(() => {
    console.log('Server is listening.');
  });
