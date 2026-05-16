import type {BattleState} from '../../core/types';
import type {VisualState} from '../types';
import {renderBattleFrame} from './BattleFrame';
import {renderControls} from './Controls';
import {renderLegalNote} from './LegalNote';
import {renderTeamStrip} from './TeamStrip';
import {renderTopBar} from './TopBar';

interface BattleScreenOptions {
  battle: BattleState;
  visual: VisualState;
  running: boolean;
  speed: number;
}

export function renderBattleScreen({battle, visual, running, speed}: BattleScreenOptions): string {
  return `
    <main class="game-shell">
      ${renderTopBar(battle, running)}
      ${renderBattleFrame(battle, visual)}
      ${renderTeamStrip(battle)}
      ${renderControls(visual, running, speed)}
      ${renderLegalNote()}
    </main>
  `;
}
