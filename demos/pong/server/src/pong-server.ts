import * as lk from 'laniakea-server';

import {
  BallMovementSystem,
  BallSpawnerSystem,
  BotLogic,
  BotSpawnerSystem,
  EntityScheduledDeletionProcessor,
  HumanPlayerId,
  InputHandlerSystem,
  LevelGeometrySystem,
  PaddleMovementSystem,
  PaddlePositionSyncSystem,
  PlayerInfo,
  PolarLerp2DProcessor,
  registerComponents,
} from 'lk-demo-pong-shared';

export function initialiseServer(serverEngine: lk.ServerEngine) {
  registerComponents(serverEngine.engine);

  serverEngine.engine.addSystem(new BotSpawnerSystem());
  serverEngine.engine.addSystem(new LevelGeometrySystem());
  serverEngine.engine.addSystem(new InputHandlerSystem());
  serverEngine.engine.addSystem(new BotLogic());
  serverEngine.engine.addSystem(new BallSpawnerSystem());
  serverEngine.engine.addSystem(new PolarLerp2DProcessor());
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
    newPlayerInfo.playerIndex = players.length + 1;
    let newHumanPlayerId = new HumanPlayerId();
    newHumanPlayerId.playerId = playerId;
    state.createEntity([newPlayerInfo, newHumanPlayerId]);
  });
}
