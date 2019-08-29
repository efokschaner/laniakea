import * as lk from '@laniakea/base-engine';

import { GamePhase, GamePhaseComponent } from './components';

export function getCurrentGamePhase(state: lk.EntityComponentState): GamePhase | undefined {
  let gamePhases = Array.from(state.getComponents(GamePhaseComponent));
  let gamePhase = gamePhases[0];
  if (gamePhase !== undefined) {
    return gamePhase.getData().currentGamePhase;
  }
  return undefined;
}
