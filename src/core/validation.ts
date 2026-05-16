import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dexData, getMove} from './dex';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isAttack(moveId: string): boolean {
  const move = getMove(moveId);
  return move.basePower > 0 || move.damage !== null || move.ohko;
}

function isSupport(moveId: string): boolean {
  const move = getMove(moveId);
  return move.category === 'Status' && !isAttack(moveId);
}

export function validateBattleData(checkFilesystem = false): ValidationResult {
  const errors: string[] = [];
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  if (dexData.species.length !== 151) {
    errors.push(`Expected 151 species, found ${dexData.species.length}.`);
  }

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

    if (checkFilesystem) {
      const imagePath = path.join(rootDir, 'src', 'resources', 'pokemon', `${species.num.toString().padStart(4, '0')}.webp`);
      if (!existsSync(imagePath)) errors.push(`${species.name} image not found at ${imagePath}.`);
    }
  }

  return {ok: errors.length === 0, errors};
}
