import rawData from '../data/showdown-gen1.json';
import type {Gen1DexData, MoveData, PokemonSpecies} from './types';

export const dexData = rawData as unknown as Gen1DexData;

export const speciesById = new Map<string, PokemonSpecies>(
  dexData.species.map(species => [species.id, species])
);

export const movesById = new Map<string, MoveData>(
  Object.entries(dexData.moves)
);

export function getMove(moveId: string): MoveData {
  const move = movesById.get(moveId);
  if (!move) throw new Error(`Unknown move: ${moveId}`);
  return move;
}

export function getSpecies(speciesId: string): PokemonSpecies {
  const species = speciesById.get(speciesId);
  if (!species) throw new Error(`Unknown species: ${speciesId}`);
  return species;
}

export function getTypeMultiplier(attackType: string, defenderTypes: readonly string[]): number {
  return defenderTypes.reduce((multiplier, defenseType) => {
    return multiplier * (dexData.typeChart[attackType]?.[defenseType] ?? 1);
  }, 1);
}

export function imagePathForSpecies(species: PokemonSpecies): string {
  return `resources/pokemon/${species.num.toString().padStart(4, '0')}.webp`;
}
