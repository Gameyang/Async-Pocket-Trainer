import type {Combatant, StatId} from '../types';
import {accuracyBoostTable} from './constants';
import {clamp} from './utils';

function statStageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

export function accuracyStagePercent(stage: number): number {
  return accuracyBoostTable[clamp(stage, -6, 6) + 6];
}

export function modifiedStat(combatant: Combatant, stat: Exclude<StatId, 'hp'>, ignoreBoosts: boolean): number {
  let value = combatant.stats[stat];
  if (!ignoreBoosts) value = Math.floor(value * statStageMultiplier(combatant.boosts[stat]));
  if (stat === 'atk' && combatant.status === 'brn' && !ignoreBoosts) value = Math.max(1, Math.floor(value / 2));
  if (stat === 'spe' && combatant.status === 'par') value = Math.max(1, Math.floor(value / 4));
  return Math.max(1, value);
}

export function effectiveSpeed(combatant: Combatant): number {
  return modifiedStat(combatant, 'spe', false);
}

export function calculateConfusionDamage(user: Combatant): number {
  const attack = modifiedStat(user, 'atk', false);
  const defense = modifiedStat(user, 'def', false);
  const base = Math.floor(Math.floor((((Math.floor((2 * user.level) / 5) + 2) * 40 * attack) / defense) / 50) + 2);
  return Math.max(1, base);
}

