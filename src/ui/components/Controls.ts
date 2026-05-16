import {escapeHtml} from '../html';
import type {VisualState} from '../types';

export function renderControls(visual: VisualState, running: boolean, speed: number): string {
  return `
    <section class="battle-controls" aria-label="전투 컨트롤">
      <label class="seed-field">
        <span>SEED</span>
        <input id="seed-input" value="${escapeHtml(visual.seedDraft)}" spellcheck="false" />
      </label>
      <button id="restart-seed" data-action="restart-seed" class="control-button warning" type="button">시드 재시작</button>
      <button id="new-battle" data-action="new-battle" class="control-button primary" type="button">새 배틀</button>
      <button id="toggle-run" data-action="toggle-run" class="control-button danger" type="button">${running ? '일시정지' : '재개'}</button>
      <button id="speed-button" data-action="cycle-speed" class="control-button speed" type="button">속도 ${speed}x</button>
    </section>
  `;
}
