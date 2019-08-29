import * as lk from '@laniakea/server-engine';

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
import { GamePhaseSystem } from './game-phase-system';

export function initialiseServer(serverEngine: lk.ServerEngine) {
  registerComponents(serverEngine);

  serverEngine.addSystem(new GamePhaseSystem());
  serverEngine.addSystem(new BotSpawnerSystem());
  serverEngine.addSystem(new LevelGeometrySystem());
  serverEngine.addSystem(new InputHandlerSystem());
  serverEngine.addSystem(new BotLogic());
  serverEngine.addSystem(new BallSpawnerSystem());
  serverEngine.addSystem(new PolarLerp2DProcessor());
  serverEngine.addSystem(new EntityScheduledDeletionProcessor());
  serverEngine.addSystem(new PaddleMovementSystem());
  serverEngine.addSystem(new PaddlePositionSyncSystem());
  serverEngine.addSystem(new BallMovementSystem(true));

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
    let newHumanPlayer = state.createEntity();
    newHumanPlayer.setComponent(newPlayerInfo);
    newHumanPlayer.setComponent(newHumanPlayerId);
  });
}
