import type {BattleEvent, BattleState} from '../core/types';
import type {VisualState} from '../ui/types';

export function createInitialVisualState(battle: BattleState): VisualState {
  return {
    hp: [battle.sides[0].hp, battle.sides[1].hp],
    message: `${battle.sides[0].species.name}와 ${battle.sides[1].species.name}의 전투가 시작됐다!`,
    activeSide: null,
    impactSide: null,
    statusSide: null,
    animation: null,
    eventQueue: [],
    seedDraft: battle.seed,
  };
}

export function clearTransientVisualState(visual: VisualState): void {
  visual.activeSide = null;
  visual.impactSide = null;
  visual.statusSide = null;
  visual.animation = null;
}

export function applyVisualEvent(visual: VisualState, battle: BattleState, event: BattleEvent): number {
  clearTransientVisualState(visual);

  switch (event.kind) {
    case 'message':
      visual.message = event.text;
      return event.tone === 'system' ? 420 : 620;
    case 'move':
      visual.activeSide = event.side;
      visual.animation = 'attack';
      visual.message = `${battle.sides[event.side].species.name}의 ${event.moveName}!`;
      return 520;
    case 'damage':
      visual.hp[event.side] = event.hp;
      visual.impactSide = event.side;
      visual.animation = 'impact';
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
      return 430;
    case 'faint':
      visual.impactSide = event.side;
      visual.animation = 'faint';
      return 760;
    case 'winner':
      visual.message = event.winner === 'draw' ? '승부가 나지 않았다!' : `${battle.sides[event.winner].species.name}의 승리!`;
      return 900;
  }
}
