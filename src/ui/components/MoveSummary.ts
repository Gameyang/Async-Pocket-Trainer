import {getMove} from '../../core/dex';
import type {Combatant} from '../../core/types';
import {escapeHtml} from '../html';
import {categoryLabels} from '../labels';

export function renderMoveSummary(combatant: Combatant): string {
  const attack = getMove(combatant.selectedMoves.attack);
  const support = getMove(combatant.selectedMoves.support);

  return `
    <div class="move-summary">
      <span><b>70%</b> ${escapeHtml(attack.name)} · ${escapeHtml(attack.type)}/${categoryLabels[attack.category]}</span>
      <span><b>30%</b> ${escapeHtml(support.name)} · ${escapeHtml(support.type)}/${categoryLabels[support.category]}</span>
    </div>
  `;
}
