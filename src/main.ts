import './styles.css';
import {advanceTurn, createBattle} from './core/battle';
import {getMove, imagePathForSpecies} from './core/dex';
import type {BattleState, Combatant, MajorStatus} from './core/types';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('App root not found.');
const root = app;

let battle = createBattle();
let running = true;
let timer: number | null = null;

const statusLabels: Record<MajorStatus, string> = {
  brn: '화상',
  par: '마비',
  psn: '독',
  slp: '수면',
  frz: '얼음',
};

function hpPercent(combatant: Combatant): number {
  return Math.max(0, Math.round((combatant.hp / combatant.maxHp) * 100));
}

function combatantStatus(combatant: Combatant): string {
  const labels: string[] = [];
  if (combatant.status) labels.push(statusLabels[combatant.status]);
  if (combatant.confusionTurns > 0) labels.push('혼란');
  if (combatant.leechSeedBy !== null) labels.push('씨뿌리기');
  if (combatant.substituteHp > 0) labels.push('대타');
  if (combatant.reflect) labels.push('리플렉터');
  if (combatant.lightScreen) labels.push('빛의장막');
  if (combatant.mist) labels.push('흰안개');
  return labels.length > 0 ? labels.join(' / ') : '정상';
}

function typeBadges(types: readonly string[]): string {
  return types.map(type => `<span class="type type-${type.toLowerCase()}">${type}</span>`).join('');
}

function movePill(moveId: string, role: 'attack' | 'support'): string {
  const move = getMove(moveId);
  return `
    <div class="move-pill ${role}">
      <span>${role === 'attack' ? '공격' : '보조'}</span>
      <strong>${move.name}</strong>
      <small>${move.type} · ${move.category}</small>
    </div>
  `;
}

function renderCombatant(combatant: Combatant, align: 'left' | 'right'): string {
  const percent = hpPercent(combatant);
  return `
    <article class="fighter ${align}">
      <div class="fighter-topline">
        <span class="dex-no">No.${combatant.species.num.toString().padStart(3, '0')}</span>
        <span class="level">Lv.${combatant.level}</span>
      </div>
      <div class="portrait-wrap">
        <img src="${imagePathForSpecies(combatant.species)}" alt="${combatant.species.name}" />
      </div>
      <div class="fighter-copy">
        <h2>${combatant.species.name}</h2>
        <div class="types">${typeBadges(combatant.transformedTypes ?? combatant.species.types)}</div>
      </div>
      <div class="hp-block">
        <div class="hp-meta">
          <span>HP</span>
          <strong>${combatant.hp}/${combatant.maxHp}</strong>
        </div>
        <div class="hp-track">
          <div class="hp-fill" style="width:${percent}%"></div>
        </div>
      </div>
      <p class="condition">${combatantStatus(combatant)}</p>
      <div class="moves">
        ${movePill(combatant.selectedMoves.attack, 'attack')}
        ${movePill(combatant.selectedMoves.support, 'support')}
      </div>
    </article>
  `;
}

function winnerText(state: BattleState): string {
  if (state.winner === null) return '자동 전투 진행 중';
  if (state.winner === 'draw') return '무승부';
  return `${state.sides[state.winner].species.name} 승리`;
}

function render(): void {
  const [left, right] = battle.sides;
  root.innerHTML = `
    <main class="page-shell">
      <section class="hero-card">
        <div>
          <p class="eyebrow">Gen 1 Auto Battle MVP</p>
          <h1>Async Pocket Trainer</h1>
        </div>
        <div class="battle-state">
          <span>TURN ${battle.turn}</span>
          <strong>${winnerText(battle)}</strong>
        </div>
      </section>

      <section class="controls" aria-label="전투 컨트롤">
        <label>
          <span>시드</span>
          <input id="seed-input" value="${battle.seed}" spellcheck="false" />
        </label>
        <button id="restart-seed" type="button">시드 재시작</button>
        <button id="new-battle" type="button">새 랜덤 배틀</button>
        <button id="toggle-run" type="button">${running ? '일시정지' : '자동 진행'}</button>
        <button id="step-turn" type="button">1턴 진행</button>
      </section>

      <section class="arena">
        ${renderCombatant(left, 'left')}
        <div class="versus">
          <span>70%</span>
          <strong>VS</strong>
          <span>30%</span>
          <small>공격기 / 보조기</small>
        </div>
        ${renderCombatant(right, 'right')}
      </section>

      <section class="log-panel">
        <div class="section-heading">
          <h2>배틀 로그</h2>
          <span>${battle.logs.length} entries</span>
        </div>
        <ol class="battle-log">
          ${battle.logs.map(entry => `<li class="${entry.tone}"><span>T${entry.turn}</span>${entry.text}</li>`).join('')}
        </ol>
      </section>

      <footer class="notice">
        Pokemon Showdown MIT 데이터/로직을 참고해 경량 구현했습니다. 포켓몬 관련 권리는 각 권리자에게 있습니다.
      </footer>
    </main>
  `;

  bindControls();
}

function bindControls(): void {
  document.querySelector<HTMLButtonElement>('#new-battle')?.addEventListener('click', () => {
    battle = createBattle();
    running = true;
    render();
  });

  document.querySelector<HTMLButtonElement>('#restart-seed')?.addEventListener('click', () => {
    const input = document.querySelector<HTMLInputElement>('#seed-input');
    battle = createBattle(input?.value.trim() || battle.seed);
    running = true;
    render();
  });

  document.querySelector<HTMLButtonElement>('#toggle-run')?.addEventListener('click', () => {
    running = !running;
    render();
  });

  document.querySelector<HTMLButtonElement>('#step-turn')?.addEventListener('click', () => {
    running = false;
    advanceTurn(battle);
    render();
  });
}

function tick(): void {
  if (running && battle.winner === null) {
    advanceTurn(battle);
    render();
  }
  if (battle.winner !== null) running = false;
}

render();
timer = window.setInterval(tick, 850);

window.addEventListener('beforeunload', () => {
  if (timer !== null) window.clearInterval(timer);
});
