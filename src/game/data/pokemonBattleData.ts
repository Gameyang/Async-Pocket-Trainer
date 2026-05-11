export type LocalizedNames = {
  en: string;
  ko: string;
};

export type StatBlock = {
  hp: number;
  attack: number;
  defense: number;
  "special-attack": number;
  "special-defense": number;
  speed: number;
};

export type LearnsetEntry = [moveId: number, level: number, order: number | null];

export type PokemonMoveMethod =
  | "level-up"
  | "egg"
  | "tutor"
  | "machine"
  | "stadium-surfing-pikachu"
  | "light-ball-egg"
  | "colosseum-purification";

export type LearnsetsByVersionGroup = Record<
  string,
  Partial<Record<PokemonMoveMethod, LearnsetEntry[]>>
>;

export type PokemonBattleData = {
  schemaVersion: 1;
  source: {
    repository: string;
    commit: string;
    csvPath: string;
    license: string;
    generatedAt: string;
    runtimeSubset?: string;
  };
  coverage: {
    pokemonCount: number;
    pokedexRange: [number, number];
    learnsetRows: number;
    moveCount: number;
    abilityCount: number;
    typeCount: number;
    defaultLearnsetVersionGroup: string;
    completeLearnsetVersionGroups: string[];
  };
  versionGroups: VersionGroupRecord[];
  stats: StatRecord[];
  types: TypeRecord[];
  typeChart: Record<string, Record<string, number>>;
  growthRates: GrowthRateRecord[];
  abilities: AbilityRecord[];
  moves: MoveRecord[];
  pokemon: PokemonRecord[];
};

export type VersionGroupRecord = {
  id: number;
  identifier: string;
  generationId: number;
  order: number;
};

export type StatRecord = {
  id: number;
  identifier: string;
  names: LocalizedNames;
  battleOnly: boolean;
  gameIndex: number | null;
  damageClass: string | null;
};

export type TypeRecord = {
  id: number;
  identifier: string;
  names: LocalizedNames;
  generationId: number | null;
  damageClass: string | null;
};

export type GrowthRateRecord = {
  id: number;
  identifier: string;
  formula: string;
  experienceByLevel: Record<string, number>;
};

export type AbilityRecord = {
  id: number;
  identifier: string;
  names: LocalizedNames;
  generationId: number;
  mainSeries: boolean;
  shortEffect: string;
};

export type MoveRecord = {
  id: number;
  identifier: string;
  names: LocalizedNames;
  generationId: number;
  type: string;
  power: number | null;
  pp: number | null;
  accuracy: number | null;
  priority: number;
  target: string | null;
  damageClass: string | null;
  effectId: number | null;
  effectChance: number | null;
  shortEffect: string;
  meta: MoveMeta | null;
  statChanges: Array<{
    stat: string;
    change: number;
  }>;
  flags: string[];
};

export type MoveMeta = {
  category: string | null;
  ailment: string | null;
  minHits: number | null;
  maxHits: number | null;
  minTurns: number | null;
  maxTurns: number | null;
  drain: number;
  healing: number;
  critRate: number;
  ailmentChance: number;
  flinchChance: number;
  statChance: number;
};

export type PokemonRecord = {
  id: number;
  dexNumber: number;
  identifier: string;
  names: LocalizedNames;
  genus: LocalizedNames;
  asset: string;
  heightDm: number;
  weightHg: number;
  baseExperience: number | null;
  order: number;
  types: string[];
  baseStats: StatBlock;
  evYield: StatBlock;
  abilities: Array<{
    abilityId: number;
    identifier: string;
    slot: number;
    hidden: boolean;
  }>;
  species: {
    generationId: number;
    evolvesFromSpeciesId: number | null;
    evolutionChainId: number;
    captureRate: number;
    baseHappiness: number;
    genderRate: number;
    hatchCounter: number;
    growthRate: string;
    baby: boolean;
    legendary: boolean;
    mythical: boolean;
  };
  evolvesTo: EvolutionTarget[];
  learnsets: LearnsetsByVersionGroup;
};

export type EvolutionTarget = {
  speciesId: number;
  pokemonId: number | null;
  identifier: string;
  names: LocalizedNames;
  condition: Record<string, unknown>;
};

export const pokemonBattleDataUrl = new URL("./pokemonBattleData.json", import.meta.url).href;

export async function loadPokemonBattleData(): Promise<PokemonBattleData> {
  const response = await fetch(pokemonBattleDataUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to load Pokemon battle data: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as PokemonBattleData;
}
