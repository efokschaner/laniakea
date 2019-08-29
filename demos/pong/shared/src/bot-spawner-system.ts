import * as lk from '@laniakea/base-engine';
import { BotSpawner, GamePhase, PlayerInfo } from './components';
import { NUM_PLAYERS_REQUIRED_TO_START } from './constants';
import { getCurrentGamePhase } from './game-phase';

function getOrCreateBotSpawner(state: lk.EntityComponentState): lk.Component<BotSpawner> {
  let spawners = Array.from(state.getComponents(BotSpawner));
  let spawner = spawners[0];
  if (spawner !== undefined) {
    return spawner;
  }
  let spawnerComponent = new BotSpawner();
  return state.createEntity().setComponent(spawnerComponent);
}

export class BotSpawnerSystem implements lk.System {
  public Step({simulationTimeS, state}: lk.StepParams): void {
    if (getCurrentGamePhase(state) !== GamePhase.WaitingForPlayers) {
      return;
    }
    let spawner = getOrCreateBotSpawner(state);
    let players = Array.from(state.getComponents(PlayerInfo));
    let alivePlayers = players.filter((pi) => pi.getData().alive);
    let numPlayersAlive = alivePlayers.length;
    let isTimeToSpawn = spawner.getData().lastBotSpawnTimeS <= simulationTimeS - 1;
    if (isTimeToSpawn && numPlayersAlive <= NUM_PLAYERS_REQUIRED_TO_START) {
      spawner.getData().lastBotSpawnTimeS = simulationTimeS;
      let newPlayerInfo = new PlayerInfo();
      newPlayerInfo.playerIndex = players.length + 1;
      state.createEntity().setComponent(newPlayerInfo);
    }
  }
}
