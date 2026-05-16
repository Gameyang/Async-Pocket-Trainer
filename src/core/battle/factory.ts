import {createRng, createSeed} from '../rng';
import {chooseRandomSpeciesPair, createCombatant} from '../teamBuilder';
import type {BattleState} from '../types';
import {maxTurns} from './constants';
import {advanceTurn} from './turn';

export function createBattle(seed = createSeed()): BattleState {
  const rng = createRng(seed);
  const [leftSpecies, rightSpecies] = chooseRandomSpeciesPair(rng);
  const left = createCombatant(0, leftSpecies, rng.int(5, 50), rng);
  const right = createCombatant(1, rightSpecies, rng.int(5, 50), rng);

  return {
    seed,
    rngState: rng.getState(),
    turn: 0,
    sides: [left, right],
    logs: [
      {turn: 0, text: `${left.species.name} Lv.${left.level} vs ${right.species.name} Lv.${right.level}`, tone: 'system'},
      {turn: 0, text: `시드 ${seed}로 전투를 시작했다.`, tone: 'system'},
    ],
    events: [],
    lastDamage: 0,
    lastDamageMoveType: null,
    lastDamageMoveId: null,
    winner: null,
  };
}

export function runBattle(seed: string, turns = maxTurns): BattleState {
  const state = createBattle(seed);
  while (state.winner === null && state.turn < turns) advanceTurn(state);
  return state;
}
