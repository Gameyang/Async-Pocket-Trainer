import type {BattleState} from '../../core/types';
import {escapeHtml} from '../html';

function winnerLabel(state: BattleState, running: boolean): string {
  if (state.winner === null) return running ? 'AUTO BATTLE' : 'PAUSED';
  if (state.winner === 'draw') return 'DRAW';
  return `${state.sides[state.winner].species.name} WIN`;
}

export function renderTopBar(battle: BattleState, running: boolean): string {
  return `
    <header class="top-bar">
      <div>
        <span class="kicker">GEN 1 · AUTO 70/30</span>
        <h1>ASYNC POCKET TRAINER</h1>
      </div>
      <div class="match-chip">
        <span>TURN ${battle.turn}</span>
        <strong>${escapeHtml(winnerLabel(battle, running))}</strong>
      </div>
    </header>
  `;
}
