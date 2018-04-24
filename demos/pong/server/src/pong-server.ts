import * as lk from 'laniakea-server';

import {
  BallMovementSystem,
  BallSpawnerSystem,
  EntityScheduledDeletionProcessor,
  HumanPlayerId,
  InputHandlerSystem,
  Lerp2DProcessor,
  LevelGeometrySystem,
  PaddleMovementSystem,
  PaddlePositionSyncSystem,
  PlayerInfo,
  registerComponents,
  BotLogic,
  BotSpawnerSystem,
} from 'lk-demo-pong-shared';

export function initialiseServer(serverEngine: lk.ServerEngine) {
  registerComponents(serverEngine.engine);

  serverEngine.engine.addSystem(new BotSpawnerSystem());
  serverEngine.engine.addSystem(new LevelGeometrySystem());
  serverEngine.engine.addSystem(new InputHandlerSystem());
  serverEngine.engine.addSystem(new BotLogic());
  serverEngine.engine.addSystem(new BallSpawnerSystem());
  serverEngine.engine.addSystem(new Lerp2DProcessor());
  serverEngine.engine.addSystem(new EntityScheduledDeletionProcessor());
  serverEngine.engine.addSystem(new PaddleMovementSystem());
  serverEngine.engine.addSystem(new PaddlePositionSyncSystem());
  serverEngine.engine.addSystem(new BallMovementSystem(true));


  serverEngine.onPlayerConnected.attach((playerId) => {
    let state = serverEngine.currentFrame.state;
    let humanPlayers = Array.from(state.getComponents(HumanPlayerId));
    if (humanPlayers.findIndex((hp) => hp.getData().playerId === playerId) !== -1) {
      // This human is already in the game, do nothing.
      return;
    }
    let players = Array.from(state.getComponents(PlayerInfo));
    let newPlayerInfo = new PlayerInfo();
    newPlayerInfo.playerIndex = players.length;
    let newHumanPlayerId = new HumanPlayerId();
    newHumanPlayerId.playerId = playerId;
    state.createEntity([newPlayerInfo, newHumanPlayerId]);
  });
}
