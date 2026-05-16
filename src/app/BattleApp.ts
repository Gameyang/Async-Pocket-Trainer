import {advanceTurn, createBattle} from '../core/battle';
import type {BattleState} from '../core/types';
import {renderBattleScreen} from '../ui/components/BattleScreen';
import type {VisualState} from '../ui/types';
import {BattleAudio} from './audio';
import {applyVisualEvent, clearTransientVisualState, createInitialVisualState} from './visualEvents';

interface BattleAppHandle {
  dispose(): void;
}

export function mountBattleApp(root: HTMLElement): BattleAppHandle {
  const app = new BattleApp(root);
  app.mount();
  return {
    dispose: () => app.dispose(),
  };
}

class BattleApp {
  #battle: BattleState = createBattle();
  #visual: VisualState = createInitialVisualState(this.#battle);
  #running = true;
  #speed = 2;
  #timer: number | null = null;
  readonly #audio = new BattleAudio();
  readonly #root: HTMLElement;

  constructor(root: HTMLElement) {
    this.#root = root;
  }

  mount(): void {
    this.#root.addEventListener('pointerdown', this.#unlockAudio, {once: true});
    this.#root.addEventListener('input', this.#handleInput);
    this.#root.addEventListener('click', this.#handleClick);
    this.#render();
    this.#timer = window.setTimeout(this.#stepBattle, this.#scaled(650));
  }

  dispose(): void {
    this.#clearTimer();
    this.#root.removeEventListener('input', this.#handleInput);
    this.#root.removeEventListener('click', this.#handleClick);
    this.#root.removeEventListener('pointerdown', this.#unlockAudio);
  }

  #scaled(ms: number): number {
    return Math.max(90, Math.floor(ms / this.#speed));
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      window.clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #render(): void {
    this.#root.innerHTML = renderBattleScreen({
      battle: this.#battle,
      visual: this.#visual,
      running: this.#running,
      speed: this.#speed,
    });
  }

  readonly #unlockAudio = (): void => {
    this.#audio.unlock();
  };

  readonly #handleInput = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.id !== 'seed-input') return;

    this.#visual.seedDraft = target.value;
  };

  readonly #handleClick = (event: MouseEvent): void => {
    const target = event.target;
    const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
    if (!element) return;

    const action = element.closest<HTMLElement>('[data-action]')?.dataset.action;
    if (!action) return;

    this.#unlockAudio();

    switch (action) {
      case 'restart-seed':
        this.#resetBattle(this.#visual.seedDraft.trim() || this.#battle.seed);
        break;
      case 'new-battle':
        this.#resetBattle();
        break;
      case 'toggle-run':
        this.#toggleRunning();
        break;
      case 'cycle-speed':
        this.#cycleSpeed();
        break;
    }
  };

  readonly #playNextEvent = (): void => {
    this.#clearTimer();
    if (!this.#running) {
      this.#render();
      return;
    }

    const nextEvent = this.#visual.eventQueue.shift();
    if (!nextEvent) {
      clearTransientVisualState(this.#visual);
      this.#render();

      if (this.#running && this.#battle.winner === null) {
        this.#timer = window.setTimeout(this.#stepBattle, this.#scaled(620));
      }
      return;
    }

    const delay = applyVisualEvent(this.#visual, this.#battle, nextEvent);
    this.#audio.playEvent(nextEvent);
    this.#render();
    this.#timer = window.setTimeout(this.#playNextEvent, this.#scaled(delay));
  };

  readonly #stepBattle = (): void => {
    if (!this.#running || this.#battle.winner !== null || this.#visual.eventQueue.length > 0) return;

    advanceTurn(this.#battle);
    this.#visual.eventQueue = [...this.#battle.events];
    this.#playNextEvent();
  };

  #resetBattle(seed?: string): void {
    this.#battle = createBattle(seed);
    this.#visual = createInitialVisualState(this.#battle);
    this.#running = true;
    this.#clearTimer();
    this.#render();
    this.#timer = window.setTimeout(this.#stepBattle, this.#scaled(650));
  }

  #toggleRunning(): void {
    this.#running = !this.#running;
    this.#clearTimer();
    this.#render();

    if (this.#running) {
      this.#timer = window.setTimeout(
        this.#visual.eventQueue.length > 0 ? this.#playNextEvent : this.#stepBattle,
        this.#scaled(180)
      );
    }
  }

  #cycleSpeed(): void {
    this.#speed = this.#speed === 1 ? 2 : this.#speed === 2 ? 4 : 1;
    this.#render();
  }
}
