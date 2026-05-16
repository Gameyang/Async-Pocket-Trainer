import './styles.css';
import {advanceTurn, createBattle} from './core/battle';
import {getMove, imagePathForSpecies} from './core/dex';
import type {BattleEvent, BattleState, Combatant, MajorStatus, MoveCategory, SideId} from './core/types';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('App root not found.');
const root = appRoot;

type AnimationSlot = 'attack' | 'impact' | 'status' | 'faint' | null;

interface VisualState {
  hp: [number, number];
  message: string;
  activeSide: SideId | null;
  impactSide: SideId | null;
  statusSide: SideId | null;
  animation: AnimationSlot;
  eventQueue: BattleEvent[];
  seedDraft: string;
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

let battle = createBattle();
let running = true;
let speed = 2;
let audioUnlocked = false;
let timer: number | null = null;

let visual: VisualState = {
  hp: [battle.sides[0].hp, battle.sides[1].hp],
  message: `${battle.sides[0].species.name}와 ${battle.sides[1].species.name}의 전투가 시작됐다!`,
  activeSide: null,
  impactSide: null,
  statusSide: null,
  animation: null,
  eventQueue: [],
  seedDraft: battle.seed,
};

function scaled(ms: number): number {
  return Math.max(90, Math.floor(ms / speed));
}

function clearTimer(): void {
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

function hpPercent(side: SideId): number {
  const combatant = battle.sides[side];
  return Math.max(0, Math.round((visual.hp[side] / combatant.maxHp) * 100));
}

function hpTone(side: SideId): string {
  const percent = hpPercent(side);
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
  return statuses.map(status => `<span class="status-badge">${status}</span>`).join('');
}

function typeBadges(combatant: Combatant): string {
  const types = combatant.transformedTypes ?? combatant.species.types;
  return types.map(type => `<span class="type-badge type-${type.toLowerCase()}">${type}</span>`).join('');
}

function moveSummary(combatant: Combatant): string {
  const attack = getMove(combatant.selectedMoves.attack);
  const support = getMove(combatant.selectedMoves.support);
  return `
    <div class="move-summary">
      <span><b>70%</b> ${attack.name} · ${attack.type}/${categoryLabels[attack.category]}</span>
      <span><b>30%</b> ${support.name} · ${support.type}/${categoryLabels[support.category]}</span>
    </div>
  `;
}

function renderHud(side: SideId): string {
  const combatant = battle.sides[side];
  const alignment = side === 0 ? 'player' : 'enemy';
  const percent = hpPercent(side);

  return `
    <section class="hud ${alignment}">
      <div class="hud-name">
        <strong>${combatant.species.name}</strong>
        <span>Lv.${combatant.level}</span>
      </div>
      <div class="hp-row">
        <span>HP</span>
        <div class="hp-meter ${hpTone(side)}">
          <div style="width: ${percent}%"></div>
        </div>
      </div>
      <div class="hp-numbers">${visual.hp[side]}/${combatant.maxHp}</div>
      <div class="badge-row">${typeBadges(combatant)}${statusBadges(combatant)}</div>
    </section>
  `;
}

function renderSprite(side: SideId): string {
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
        alt="${combatant.species.name}"
      />
    </div>
  `;
}

function winnerLabel(state: BattleState): string {
  if (state.winner === null) return running ? 'AUTO BATTLE' : 'PAUSED';
  if (state.winner === 'draw') return 'DRAW';
  return `${state.sides[state.winner].species.name} WIN`;
}

function renderControls(): string {
  return `
    <section class="battle-controls" aria-label="전투 컨트롤">
      <label class="seed-field">
        <span>SEED</span>
        <input id="seed-input" value="${visual.seedDraft}" spellcheck="false" />
      </label>
      <button id="restart-seed" type="button">시드 재시작</button>
      <button id="new-battle" type="button">새 배틀</button>
      <button id="toggle-run" type="button">${running ? '일시정지' : '재개'}</button>
      <button id="speed-button" type="button">속도 ${speed}x</button>
    </section>
  `;
}

function render(): void {
  root.innerHTML = `
    <main class="game-shell">
      <header class="top-bar">
        <div>
          <span class="kicker">GEN 1 · AUTO 70/30</span>
          <h1>ASYNC POCKET TRAINER</h1>
        </div>
        <div class="match-chip">
          <span>TURN ${battle.turn}</span>
          <strong>${winnerLabel(battle)}</strong>
        </div>
      </header>

      <section class="battle-frame" aria-label="자동 배틀 화면">
        <div class="scanline"></div>
        ${renderHud(1)}
        ${renderHud(0)}
        ${renderSprite(1)}
        ${renderSprite(0)}
        <div class="message-box">
          <p>${visual.message}</p>
          <span class="message-caret"></span>
        </div>
      </section>

      <section class="team-strip">
        ${moveSummary(battle.sides[0])}
        ${moveSummary(battle.sides[1])}
      </section>

      ${renderControls()}

      <footer class="legal-note">
        Pokemon Showdown MIT 데이터와 Gen1 규칙을 참고한 팬 프로젝트입니다.
      </footer>
    </main>
  `;

  bindControls();
}

function unlockAudio(): void {
  audioUnlocked = true;
}

function playAudio(path: string, volume = 0.42): void {
  if (!audioUnlocked) return;
  const audio = new Audio(path);
  audio.volume = volume;
  void audio.play().catch(() => undefined);
}

function playEventAudio(event: BattleEvent): void {
  if (event.kind === 'move') {
    const type = event.moveType.toLowerCase();
    const folder = event.category === 'Status' ? 'support' : 'type';
    const prefix = event.category === 'Status' ? 'battle-support-type' : 'battle-type';
    playAudio(`audio/sfx/battle/${folder}/${prefix}-${type}.m4a`, 0.28);
  }
  if (event.kind === 'damage') playAudio('audio/sfx/battle/core/battle-hit.m4a', 0.34);
  if (event.kind === 'miss') playAudio('audio/sfx/battle/core/battle-miss.m4a', 0.34);
  if (event.kind === 'faint') playAudio('audio/sfx/battle/core/creature-faint.m4a', 0.38);
}

function applyVisualEvent(event: BattleEvent): number {
  visual.activeSide = null;
  visual.impactSide = null;
  visual.statusSide = null;
  visual.animation = null;

  switch (event.kind) {
    case 'message':
      visual.message = event.text;
      return event.tone === 'system' ? 420 : 620;
    case 'move':
      visual.activeSide = event.side;
      visual.animation = 'attack';
      visual.message = `${battle.sides[event.side].species.name}의 ${event.moveName}!`;
      playEventAudio(event);
      return 520;
    case 'damage':
      visual.hp[event.side] = event.hp;
      visual.impactSide = event.side;
      visual.animation = 'impact';
      playEventAudio(event);
      return 460;
    case 'heal':
      visual.hp[event.side] = event.hp;
      visual.statusSide = event.side;
      visual.animation = 'status';
      return 420;
    case 'status':
    case 'boost':
      visual.statusSide = event.side;
      visual.animation = 'status';
      return 430;
    case 'miss':
      visual.impactSide = event.targetSide;
      visual.animation = 'impact';
      playEventAudio(event);
      return 430;
    case 'faint':
      visual.impactSide = event.side;
      visual.animation = 'faint';
      playEventAudio(event);
      return 760;
    case 'winner':
      visual.message = event.winner === 'draw' ? '승부가 나지 않았다!' : `${battle.sides[event.winner].species.name}의 승리!`;
      return 900;
  }
}

function playNextEvent(): void {
  clearTimer();
  if (!running) {
    render();
    return;
  }

  const nextEvent = visual.eventQueue.shift();
  if (!nextEvent) {
    visual.activeSide = null;
    visual.impactSide = null;
    visual.statusSide = null;
    visual.animation = null;
    render();

    if (running && battle.winner === null) {
      timer = window.setTimeout(stepBattle, scaled(620));
    }
    return;
  }

  const delay = applyVisualEvent(nextEvent);
  render();
  timer = window.setTimeout(playNextEvent, scaled(delay));
}

function stepBattle(): void {
  if (!running || battle.winner !== null || visual.eventQueue.length > 0) return;
  advanceTurn(battle);
  visual.eventQueue = [...battle.events];
  playNextEvent();
}

function resetBattle(seed?: string): void {
  battle = createBattle(seed);
  visual = {
    hp: [battle.sides[0].hp, battle.sides[1].hp],
    message: `${battle.sides[0].species.name}와 ${battle.sides[1].species.name}의 전투가 시작됐다!`,
    activeSide: null,
    impactSide: null,
    statusSide: null,
    animation: null,
    eventQueue: [],
    seedDraft: battle.seed,
  };
  running = true;
  clearTimer();
  render();
  timer = window.setTimeout(stepBattle, scaled(650));
}

function bindControls(): void {
  root.querySelector<HTMLInputElement>('#seed-input')?.addEventListener('input', event => {
    visual.seedDraft = (event.target as HTMLInputElement).value;
  });

  root.querySelector<HTMLButtonElement>('#restart-seed')?.addEventListener('click', () => {
    unlockAudio();
    resetBattle(visual.seedDraft.trim() || battle.seed);
  });

  root.querySelector<HTMLButtonElement>('#new-battle')?.addEventListener('click', () => {
    unlockAudio();
    resetBattle();
  });

  root.querySelector<HTMLButtonElement>('#toggle-run')?.addEventListener('click', () => {
    unlockAudio();
    running = !running;
    clearTimer();
    render();
    if (running) {
      timer = window.setTimeout(visual.eventQueue.length > 0 ? playNextEvent : stepBattle, scaled(180));
    }
  });

  root.querySelector<HTMLButtonElement>('#speed-button')?.addEventListener('click', () => {
    unlockAudio();
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    render();
  });
}

root.addEventListener('pointerdown', unlockAudio, {once: true});

render();
timer = window.setTimeout(stepBattle, scaled(650));

window.addEventListener('beforeunload', clearTimer);
