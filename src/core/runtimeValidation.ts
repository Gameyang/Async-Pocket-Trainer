import {dexData, getMove} from './dex';
import type {MoveData} from './types';

export interface RuntimeValidationResult {
  ok: boolean;
  errors: string[];
}

const supportedStatuses = new Set(['brn', 'par', 'psn', 'slp', 'frz']);
const supportedVolatiles = new Set([
  'confusion',
  'flinch',
  'leechseed',
  'partiallytrapped',
  'focusenergy',
  'substitute',
  'disable',
  'mist',
  'lightscreen',
  'reflect',
]);
const supportedSelfVolatiles = new Set(['mustrecharge', 'rage', 'lockedmove', 'partialtrappinglock']);

function isAttack(moveId: string): boolean {
  const move = getMove(moveId);
  return move.basePower > 0 || move.damage !== null || move.ohko;
}

function isSupport(moveId: string): boolean {
  const move = getMove(moveId);
  return move.category === 'Status' && !isAttack(moveId);
}

function validateMoveEffects(move: MoveData, errors: string[]): void {
  if (move.status && !supportedStatuses.has(move.status)) errors.push(`${move.name} has unsupported status ${move.status}.`);
  if (move.volatileStatus && !supportedVolatiles.has(move.volatileStatus)) {
    errors.push(`${move.name} has unsupported volatile ${move.volatileStatus}.`);
  }
  if (move.self?.volatileStatus && !supportedSelfVolatiles.has(move.self.volatileStatus)) {
    errors.push(`${move.name} has unsupported self volatile ${move.self.volatileStatus}.`);
  }
  if (move.damage !== null && typeof move.damage !== 'number' && move.damage !== 'level') {
    errors.push(`${move.name} has unsupported fixed damage ${String(move.damage)}.`);
  }
  if (move.forceSwitch) errors.push(`${move.name} uses forceSwitch, which is unsupported in 1v1 MVP battles.`);

  for (const secondary of move.secondaries) {
    if (secondary.status && !supportedStatuses.has(secondary.status)) {
      errors.push(`${move.name} has unsupported secondary status ${secondary.status}.`);
    }
    if (secondary.volatileStatus && !supportedVolatiles.has(secondary.volatileStatus)) {
      errors.push(`${move.name} has unsupported secondary volatile ${secondary.volatileStatus}.`);
    }
  }
}

export function validateRuntimeBattleData(): RuntimeValidationResult {
  const errors: string[] = [];

  if (dexData.species.length !== 151) {
    errors.push(`Expected 151 species, found ${dexData.species.length}.`);
  }

  for (const move of Object.values(dexData.moves)) validateMoveEffects(move, errors);

  for (const species of dexData.species) {
    if (species.learnset.length === 0) errors.push(`${species.name} has no Gen1 level-up learnset.`);
    for (const learn of species.learnset) {
      if (!dexData.moves[learn.move]) errors.push(`${species.name} references unknown move ${learn.move}.`);
    }

    const unlockedAt50 = species.learnset.filter(learn => learn.level <= 50).map(learn => learn.move);
    if (!unlockedAt50.some(isAttack) && dexData.fallbackMoveIds.length === 0) {
      errors.push(`${species.name} has no attack move by level 50 and no fallback moves exist.`);
    }
    if (!unlockedAt50.some(isSupport) && dexData.fallbackMoveIds.length === 0) {
      errors.push(`${species.name} has no support move by level 50 and no fallback moves exist.`);
    }
  }

  return {ok: errors.length === 0, errors};
}
