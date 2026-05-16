import type {BattleState} from '../core/types';
import {renderBattleFrame} from './components/BattleFrame';
import {renderControls} from './components/Controls';
import {renderMoveSummary} from './components/MoveSummary';
import {escapeHtml} from './html';
import type {VisualState} from './types';

interface RenderBattleViewOptions {
  battle: BattleState;
  visual: VisualState;
  running: boolean;
  speed: number;
}

function winnerLabel(state: BattleState, running: boolean): string {
  if (state.winner === null) return running ? 'AUTO BATTLE' : 'PAUSED';
  if (state.winner === 'draw') return 'DRAW';
  return `${state.sides[state.winner].species.name} WIN`;
}

export function renderBattleView({battle, visual, running, speed}: RenderBattleViewOptions): string {
  return `
    <main class="game-shell">
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

      ${renderBattleFrame(battle, visual)}

      <section class="team-strip">
        ${renderMoveSummary(battle.sides[0])}
        ${renderMoveSummary(battle.sides[1])}
      </section>

      ${renderControls(visual, running, speed)}

      <footer class="legal-note">
        Pokemon Showdown MIT 데이터와 Gen1 규칙을 참고한 팬 프로젝트입니다.
      </footer>
    </main>
  `;
}
