import * as lk from 'laniakea-server';
lk.hookConsoleWithLogger();

import {
  GameButtonsInput,
  gameServerWsPort,
  globalSimulationRateMultiplier,
  simFPS,
} from 'lk-demo-pong-shared';

import { initialiseServer } from './pong-server';

const networkServer = new lk.NetworkServer(lk.INSECURE_AuthCallback);
let serverEngine = new lk.ServerEngine(
  networkServer,
  {
    simFPS,
    globalSimulationRateMultiplier,
  },
);

serverEngine.registerContinuousInputType(GameButtonsInput, 'GameButtonsInput');
initialiseServer(serverEngine);
serverEngine.start();
networkServer.listen({
  signalingWebsocketServerPort: gameServerWsPort,
  webrtcPeerConnectionPortRange: { min: 11213, max: 11213 }
})
.then(() => {
  console.log('networkServer is listening.');
});
