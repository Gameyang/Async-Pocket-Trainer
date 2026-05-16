import {getMove, imagePathForSpecies} from '../core/dex';
import type {BattleState, Combatant, MajorStatus, MoveCategory, SideId} from '../core/types';
import type {VisualState} from './types';

interface RenderBattleViewOptions {
  battle: BattleState;
  visual: VisualState;
  running: boolean;
  speed: number;
}

const statusLabels: Record<MajorStatus, string> = {
  brn: '화상',
  par: '마비',
  psn: '독',
  slp: '수면',
  frz: '얼음',
};

const volatileLabels: Record<string, string> = {
  confusion: '혼란',
  leechseed: '씨앗',
  partiallytrapped: '묶임',
  substitute: '대타',
  mist: '흰안개',
  lightscreen: '빛장막',
  reflect: '리플렉터',
  disable: '봉인',
  focusenergy: '기합',
};

const categoryLabels: Record<MoveCategory, string> = {
  Physical: '물리',
  Special: '특수',
  Status: '보조',
};

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function hpPercent(battle: BattleState, visual: VisualState, side: SideId): number {
  const combatant = battle.sides[side];
  return Math.max(0, Math.round((visual.hp[side] / combatant.maxHp) * 100));
}

function hpTone(battle: BattleState, visual: VisualState, side: SideId): string {
  const percent = hpPercent(battle, visual, side);
  if (percent <= 20) return 'danger';
  if (percent <= 50) return 'warn';
  return 'good';
}

function currentStatuses(combatant: Combatant): string[] {
  const statuses: string[] = [];
  if (combatant.status) statuses.push(statusLabels[combatant.status]);
  if (combatant.confusionTurns > 0) statuses.push(volatileLabels.confusion);
  if (combatant.leechSeedBy !== null) statuses.push(volatileLabels.leechseed);
  if (combatant.partialTrapTurns > 0) statuses.push(volatileLabels.partiallytrapped);
  if (combatant.substituteHp > 0) statuses.push(volatileLabels.substitute);
  if (combatant.reflect) statuses.push(volatileLabels.reflect);
  if (combatant.lightScreen) statuses.push(volatileLabels.lightscreen);
  if (combatant.mist) statuses.push(volatileLabels.mist);
  return statuses;
}

function statusBadges(combatant: Combatant): string {
  const statuses = currentStatuses(combatant);
  if (statuses.length === 0) return '<span class="status-badge normal">정상</span>';
  return statuses.map(status => `<span class="status-badge">${escapeHtml(status)}</span>`).join('');
}

function typeBadges(combatant: Combatant): string {
  const types = combatant.transformedTypes ?? combatant.species.types;
  return types
    .map(type => `<span class="type-badge type-${type.toLowerCase()}">${escapeHtml(type)}</span>`)
    .join('');
}

function moveSummary(combatant: Combatant): string {
  const attack = getMove(combatant.selectedMoves.attack);
  const support = getMove(combatant.selectedMoves.support);

  return `
    <div class="move-summary">
      <span><b>70%</b> ${escapeHtml(attack.name)} · ${escapeHtml(attack.type)}/${categoryLabels[attack.category]}</span>
      <span><b>30%</b> ${escapeHtml(support.name)} · ${escapeHtml(support.type)}/${categoryLabels[support.category]}</span>
    </div>
  `;
}

function renderHud(battle: BattleState, visual: VisualState, side: SideId): string {
  const combatant = battle.sides[side];
  const alignment = side === 0 ? 'player' : 'enemy';
  const percent = hpPercent(battle, visual, side);

  return `
    <section class="hud ${alignment}">
      <div class="hud-name">
        <strong>${escapeHtml(combatant.species.name)}</strong>
        <span>Lv.${combatant.level}</span>
      </div>
      <div class="hp-row">
        <span>HP</span>
        <div class="hp-meter ${hpTone(battle, visual, side)}">
          <div style="width: ${percent}%"></div>
        </div>
      </div>
      <div class="hp-numbers">${visual.hp[side]}/${combatant.maxHp}</div>
      <div class="badge-row">${typeBadges(combatant)}${statusBadges(combatant)}</div>
    </section>
  `;
}

function renderSprite(battle: BattleState, visual: VisualState, side: SideId): string {
  const combatant = battle.sides[side];
  const role = side === 0 ? 'player' : 'enemy';
  const active = visual.activeSide === side ? 'is-attacking' : '';
  const impact = visual.impactSide === side ? 'is-hit' : '';
  const status = visual.statusSide === side ? 'is-statused' : '';
  const fainted = combatant.hp <= 0 ? 'is-fainted' : '';

  return `
    <div class="sprite-slot ${role}">
      <div class="platform"></div>
      <img
        class="pokemon-sprite ${role} ${active} ${impact} ${status} ${fainted}"
        src="${imagePathForSpecies(combatant.species)}"
        alt="${escapeHtml(combatant.species.name)}"
      />
    </div>
  `;
}

function winnerLabel(state: BattleState, running: boolean): string {
  if (state.winner === null) return running ? 'AUTO BATTLE' : 'PAUSED';
  if (state.winner === 'draw') return 'DRAW';
  return `${state.sides[state.winner].species.name} WIN`;
}

function renderControls(visual: VisualState, running: boolean, speed: number): string {
  return `
    <section class="battle-controls" aria-label="전투 컨트롤">
      <label class="seed-field">
        <span>SEED</span>
        <input id="seed-input" value="${escapeHtml(visual.seedDraft)}" spellcheck="false" />
      </label>
      <button id="restart-seed" class="control-button warning" type="button">시드 재시작</button>
      <button id="new-battle" class="control-button primary" type="button">새 배틀</button>
      <button id="toggle-run" class="control-button danger" type="button">${running ? '일시정지' : '재개'}</button>
      <button id="speed-button" class="control-button speed" type="button">속도 ${speed}x</button>
    </section>
  `;
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

      <section class="team-strip">
        ${moveSummary(battle.sides[0])}
        ${moveSummary(battle.sides[1])}
      </section>

      ${renderControls(visual, running, speed)}

      <footer class="legal-note">
        Pokemon Showdown MIT 데이터와 Gen1 규칙을 참고한 팬 프로젝트입니다.
      </footer>
    </main>
  `;
}
