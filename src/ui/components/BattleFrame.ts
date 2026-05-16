import type {BattleState} from '../../core/types';
import {escapeHtml} from '../html';
import type {VisualState} from '../types';
import {renderHud} from './Hud';
import {renderSprite} from './Sprite';

export function renderBattleFrame(battle: BattleState, visual: VisualState): string {
  return `
    <section class="battle-frame" aria-label="자동 배틀 화면">
      <div class="arena-glow"></div>
      <div class="scanline"></div>
      ${renderHud(battle, visual, 1)}
      ${renderHud(battle, visual, 0)}
      ${renderSprite(battle, visual, 1)}
      ${renderSprite(battle, visual, 0)}
      <div class="message-box">
        <p>${escapeHtml(visual.message)}</p>
        <span class="message-caret"></span>
      </div>
    </section>
  `;
}
