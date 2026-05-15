import { SeededRng, clamp } from "./rng";
import type { PokemonStatProfile, StatDvs, Stats } from "./types";

export type StatProfileRole = "wild" | "starter" | "trainer" | "elite";

export interface CreatePokemonStatProfileOptions {
  seed: string;
  speciesId: number;
  level: number;
  role: StatProfileRole;
}

const MAX_STAT_EXP = 65_535;

const roleRanges: Record<
  StatProfileRole,
  {
    dvMin: number;
    dvMax: number;
    statExpMin: number;
    statExpMax: number;
  }
> = {
  wild: {
    dvMin: 3,
    dvMax: 12,
    statExpMin: 0,
    statExpMax: 9_000,
  },
  starter: {
    dvMin: 6,
    dvMax: 14,
    statExpMin: 4_000,
    statExpMax: 16_000,
  },
  trainer: {
    dvMin: 7,
    dvMax: 15,
    statExpMin: 7_000,
    statExpMax: 22_000,
  },
  elite: {
    dvMin: 9,
    dvMax: 15,
    statExpMin: 12_000,
    statExpMax: 32_000,
  },
};

export function createPokemonStatProfile(
  options: CreatePokemonStatProfileOptions,
): PokemonStatProfile {
  const level = normalizeLevel(options.level);
  const range = roleRanges[options.role];
  const rng = new SeededRng(
    `${options.seed}:gen1-stats:${options.role}:${options.speciesId}:${level}`,
  );

  return {
    dvs: {
      attack: rng.int(range.dvMin, range.dvMax),
      defense: rng.int(range.dvMin, range.dvMax),
      speed: rng.int(range.dvMin, range.dvMax),
      special: rng.int(range.dvMin, range.dvMax),
    },
    statExp: {
      hp: rng.int(range.statExpMin, range.statExpMax),
      attack: rng.int(range.statExpMin, range.statExpMax),
      defense: rng.int(range.statExpMin, range.statExpMax),
      special: rng.int(range.statExpMin, range.statExpMax),
      speed: rng.int(range.statExpMin, range.statExpMax),
    },
  };
}

export function calculatePokemonStats(
  baseStats: Stats,
  level: number,
  profile: PokemonStatProfile,
  bonuses: Stats = createEmptyStats(),
): Stats {
  const normalizedLevel = normalizeLevel(level);
  const normalizedProfile = normalizePokemonStatProfile(profile);
  const normalizedBonuses = normalizeStatBonuses(bonuses);
  const hpDv = deriveHpDv(normalizedProfile.dvs);

  return {
    hp:
      calculateHpStat(baseStats.hp, hpDv, normalizedProfile.statExp.hp, normalizedLevel) +
      normalizedBonuses.hp,
    attack:
      calculateRegularStat(
        baseStats.attack,
        normalizedProfile.dvs.attack,
        normalizedProfile.statExp.attack,
        normalizedLevel,
      ) + normalizedBonuses.attack,
    defense:
      calculateRegularStat(
        baseStats.defense,
        normalizedProfile.dvs.defense,
        normalizedProfile.statExp.defense,
        normalizedLevel,
      ) + normalizedBonuses.defense,
    special:
      calculateRegularStat(
        baseStats.special,
        normalizedProfile.dvs.special,
        normalizedProfile.statExp.special,
        normalizedLevel,
      ) + normalizedBonuses.special,
    speed:
      calculateRegularStat(
        baseStats.speed,
        normalizedProfile.dvs.speed,
        normalizedProfile.statExp.speed,
        normalizedLevel,
      ) + normalizedBonuses.speed,
  };
}

export function createEmptyStats(): Stats {
  return {
    hp: 0,
    attack: 0,
    defense: 0,
    special: 0,
    speed: 0,
  };
}

export function normalizePokemonStatProfile(profile: PokemonStatProfile): PokemonStatProfile {
  return {
    dvs: normalizeDvs(profile.dvs),
    statExp: normalizeStatExp(profile.statExp),
  };
}

export function normalizeStatBonuses(bonuses: Partial<Stats> | undefined): Stats {
  return {
    hp: normalizeNonNegativeInteger(bonuses?.hp ?? 0, 0, Number.MAX_SAFE_INTEGER),
    attack: normalizeNonNegativeInteger(bonuses?.attack ?? 0, 0, Number.MAX_SAFE_INTEGER),
    defense: normalizeNonNegativeInteger(bonuses?.defense ?? 0, 0, Number.MAX_SAFE_INTEGER),
    special: normalizeNonNegativeInteger(bonuses?.special ?? 0, 0, Number.MAX_SAFE_INTEGER),
    speed: normalizeNonNegativeInteger(bonuses?.speed ?? 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

export function deriveHpDv(dvs: StatDvs): number {
  const normalized = normalizeDvs(dvs);

  return (
    ((normalized.attack & 1) << 3) |
    ((normalized.defense & 1) << 2) |
    ((normalized.speed & 1) << 1) |
    (normalized.special & 1)
  );
}

export function normalizeLevel(level: number): number {
  return clamp(Math.round(level), 1, 100);
}

function calculateHpStat(base: number, dv: number, statExp: number, level: number): number {
  return Math.max(1, Math.floor((((base + dv) * 2 + statExpTerm(statExp)) * level) / 100) + level + 10);
}

function calculateRegularStat(base: number, dv: number, statExp: number, level: number): number {
  return Math.max(1, Math.floor((((base + dv) * 2 + statExpTerm(statExp)) * level) / 100) + 5);
}

function statExpTerm(statExp: number): number {
  return Math.floor(Math.sqrt(normalizeNonNegativeInteger(statExp, 0, MAX_STAT_EXP))) >> 2;
}

function normalizeDvs(dvs: StatDvs): StatDvs {
  return {
    attack: normalizeNonNegativeInteger(dvs.attack, 0, 15),
    defense: normalizeNonNegativeInteger(dvs.defense, 0, 15),
    speed: normalizeNonNegativeInteger(dvs.speed, 0, 15),
    special: normalizeNonNegativeInteger(dvs.special, 0, 15),
  };
}

function normalizeStatExp(statExp: Stats): Stats {
  return {
    hp: normalizeNonNegativeInteger(statExp.hp, 0, MAX_STAT_EXP),
    attack: normalizeNonNegativeInteger(statExp.attack, 0, MAX_STAT_EXP),
    defense: normalizeNonNegativeInteger(statExp.defense, 0, MAX_STAT_EXP),
    special: normalizeNonNegativeInteger(statExp.special, 0, MAX_STAT_EXP),
    speed: normalizeNonNegativeInteger(statExp.speed, 0, MAX_STAT_EXP),
  };
}

function normalizeNonNegativeInteger(value: number, min: number, max: number): number {
  return clamp(Number.isFinite(value) ? Math.round(value) : min, min, max);
}
