import { getSpecies, speciesCatalog, starterSpeciesIds } from "../game/data/catalog";
import type { FrameAction, GameFrame } from "../game/view/frame";
import { speciesToStarterOption } from "../game/view/frame";
import type { StorageLike } from "./clientStorage";

export const STARTER_SPECIES_CACHE_STORAGE_KEY = "apt:starter-species-cache:v1";
export const STARTER_CHOICE_LIMIT = 9;

type RandomSource = () => number;

export function loadStarterSpeciesCache(storage: StorageLike): number[] {
  const raw = storage.getItem(STARTER_SPECIES_CACHE_STORAGE_KEY);

  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("Starter species cache must be an array.");
    }

    return toUniqueValidSpeciesIds(parsed);
  } catch {
    storage.removeItem(STARTER_SPECIES_CACHE_STORAGE_KEY);
    return [];
  }
}

export function addStarterSpeciesToCache(
  storage: StorageLike,
  speciesIds: readonly number[],
): number[] {
  const merged = toUniqueValidSpeciesIds([...loadStarterSpeciesCache(storage), ...speciesIds]);
  storage.setItem(STARTER_SPECIES_CACHE_STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

export function rollStarterSpeciesIds(
  cachedSpeciesIds: readonly number[],
  random: RandomSource = Math.random,
): number[] {
  return shuffledUnique([...starterSpeciesIds, ...cachedSpeciesIds], random);
}

export function applyStarterChoicesToFrame(
  frame: GameFrame,
  speciesIds: readonly number[],
): GameFrame {
  if (frame.phase !== "starterChoice") {
    return frame;
  }

  const unlockedSpeciesIds = new Set(toUniqueValidSpeciesIds([...starterSpeciesIds, ...speciesIds]));
  const options = speciesCatalog.map(speciesToStarterOption);

  if (options.length === 0) {
    return frame;
  }

  const starterActions = options.filter((option) => unlockedSpeciesIds.has(option.speciesId)).map(
    (option): FrameAction => ({
      id: `start:${option.speciesId}`,
      label: `${option.name} 선택`,
      role: "primary",
      enabled: true,
      action: { type: "START_RUN", starterSpeciesId: option.speciesId },
    }),
  );

  return {
    ...frame,
    scene: {
      ...frame.scene,
      starterOptions: options,
    },
    actions: [
      ...frame.actions.filter((action) => action.action.type !== "START_RUN"),
      ...starterActions,
    ],
  };
}

function shuffledUnique(speciesIds: readonly number[], random: RandomSource): number[] {
  const values = toUniqueValidSpeciesIds(speciesIds);

  for (let index = values.length - 1; index > 0; index -= 1) {
    const randomValue = Math.max(0, Math.min(0.999999, random()));
    const swapIndex = Math.floor(randomValue * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }

  return values;
}

function toUniqueValidSpeciesIds(values: readonly unknown[]): number[] {
  const seen = new Set<number>();
  const speciesIds: number[] = [];

  for (const value of values) {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || seen.has(value)) {
      continue;
    }

    try {
      getSpecies(value);
    } catch {
      continue;
    }

    seen.add(value);
    speciesIds.push(value);
  }

  return speciesIds;
}
