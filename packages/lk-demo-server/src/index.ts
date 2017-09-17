import 'laniakea-server/dist/logger';

import * as lk from 'laniakea-server';

import * as demo from 'lk-demo-shared';

const networkServer = new lk.NetworkServer(lk.INSECURE_AuthCallback);
let serverEngine = new lk.ServerEngine(
  networkServer,
  {
    simFPS: demo.simFPS
  }
);
demo.ballsDemo.initialiseGame(serverEngine.engine);
demo.ballsDemo.initialiseLevel(serverEngine.engine);
serverEngine.start();
networkServer.listen(demo.gameServerWsPort)
.then(function(){
  console.log('networkServer is listening.')
});
