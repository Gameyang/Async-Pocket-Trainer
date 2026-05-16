import './styles/main.css';
import {advanceTurn, createBattle} from './core/battle';
import type {BattleEvent} from './core/types';
import {renderBattleView} from './ui/renderBattleView';
import type {VisualState} from './ui/types';

const appRoot = document.querySelector<HTMLDivElement>('#app');
if (!appRoot) throw new Error('App root not found.');
const root = appRoot;

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

function render(): void {
  root.innerHTML = renderBattleView({battle, visual, running, speed});
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
