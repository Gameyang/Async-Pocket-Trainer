import type {BattleState} from '../../core/types';
import {renderMoveSummary} from './MoveSummary';

export function renderTeamStrip(battle: BattleState): string {
  return `
    <section class="team-strip">
      ${renderMoveSummary(battle.sides[0])}
      ${renderMoveSummary(battle.sides[1])}
    </section>
  `;
}
