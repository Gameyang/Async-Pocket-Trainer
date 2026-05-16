import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dexData} from './dex';
import {validateRuntimeBattleData} from './runtimeValidation';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateBattleData(checkFilesystem = false): ValidationResult {
  const runtimeValidation = validateRuntimeBattleData();
  const errors: string[] = [...runtimeValidation.errors];
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

  if (checkFilesystem) {
    for (const species of dexData.species) {
      const imagePath = path.join(rootDir, 'src', 'resources', 'pokemon', `${species.num.toString().padStart(4, '0')}.webp`);
      if (!existsSync(imagePath)) errors.push(`${species.name} image not found at ${imagePath}.`);
    }
  }

  return {ok: errors.length === 0, errors};
}
