import * as lk from '@laniakea/base-engine';
import { GamePhase, GamePhaseComponent, NUM_PLAYERS_REQUIRED_TO_START, PlayerInfo } from 'lk-demo-pong-shared';

function getOrCreateGamePhaseComponent(state: lk.EntityComponentState): lk.Component<GamePhaseComponent> {
  let gamePhases = Array.from(state.getComponents(GamePhaseComponent));
  let gamePhase = gamePhases[0];
  if (gamePhase !== undefined) {
    return gamePhase;
  }
  let gamePhaseComponent = new GamePhaseComponent();
  return state.createEntity().setComponent(gamePhaseComponent);
}

export class GamePhaseSystem implements lk.System {
  public Step({state}: lk.StepParams): void {
    let phaseComponent = getOrCreateGamePhaseComponent(state);
    let phaseComponentData = phaseComponent.getData();
    switch (phaseComponent.getData().currentGamePhase) {
      case GamePhase.WaitingForPlayers: {
        let players = Array.from(state.getComponents(PlayerInfo));
        if (players.length >= NUM_PLAYERS_REQUIRED_TO_START) {
          phaseComponentData.currentGamePhase = GamePhase.Playing;
        }
        break;
      }
      case GamePhase.Playing: {
          let players = Array.from(state.getComponents(PlayerInfo));
          let alivePlayers = players.filter((pi) => pi.getData().alive);
          let numPlayersAlive = alivePlayers.length;
          if (numPlayersAlive === 1) {
            phaseComponentData.currentGamePhase = GamePhase.Finished;
          }
          break;
      }
      case GamePhase.Finished:
        break;
      default:
        console.error('Unhandled GamePhase');
    }
  }
}
