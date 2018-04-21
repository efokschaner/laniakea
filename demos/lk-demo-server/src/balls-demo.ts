import * as lk from 'laniakea-server';
import * as demo from 'lk-demo-shared';

export function initialiseServer(serverEngine: lk.ServerEngine) {
  demo.ballsDemo.initialiseGame(serverEngine.engine);
  demo.ballsDemo.initialiseLevel(serverEngine.currentFrame.state);
}
