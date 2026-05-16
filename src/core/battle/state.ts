import type {BattleEvent, BattleLogEntry, BattleState, Combatant, SideId} from '../types';

export function log(state: BattleState, text: string, tone: BattleLogEntry['tone'] = 'system'): void {
  state.logs.unshift({turn: state.turn, text, tone});
  state.logs = state.logs.slice(0, 120);
  state.events.push({kind: 'message', turn: state.turn, text, tone});
}

export function event(state: BattleState, battleEvent: BattleEvent): void {
  state.events.push(battleEvent);
}

export function opponentSide(side: SideId): SideId {
  return side === 0 ? 1 : 0;
}

export function opponentOf(state: BattleState, combatant: Combatant): Combatant {
  return state.sides[opponentSide(combatant.side)];
}

export function activeTypes(combatant: Combatant): string[] {
  return combatant.transformedTypes ?? combatant.species.types;
}

