import type {BattleEvent} from '../core/types';

interface AudioCue {
  path: string;
  volume: number;
}

export function audioCueForEvent(event: BattleEvent): AudioCue | null {
  switch (event.kind) {
    case 'move': {
      const type = event.moveType.toLowerCase();
      const folder = event.category === 'Status' ? 'support' : 'type';
      const prefix = event.category === 'Status' ? 'battle-support-type' : 'battle-type';
      return {path: `audio/sfx/battle/${folder}/${prefix}-${type}.m4a`, volume: 0.28};
    }
    case 'damage':
      return {path: 'audio/sfx/battle/core/battle-hit.m4a', volume: 0.34};
    case 'miss':
      return {path: 'audio/sfx/battle/core/battle-miss.m4a', volume: 0.34};
    case 'faint':
      return {path: 'audio/sfx/battle/core/creature-faint.m4a', volume: 0.38};
    default:
      return null;
  }
}

export class BattleAudio {
  #unlocked = false;

  unlock(): void {
    this.#unlocked = true;
  }

  playEvent(event: BattleEvent): void {
    const cue = audioCueForEvent(event);
    if (!cue || !this.#unlocked) return;

    const audio = new Audio(cue.path);
    audio.volume = cue.volume;
    void audio.play().catch(() => undefined);
  }
}
