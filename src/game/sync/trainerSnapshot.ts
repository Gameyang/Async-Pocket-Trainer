import { scoreCreature, scoreTeam } from "../scoring";
import { getMove, getSpecies } from "../data/catalog";
import {
  calculatePokemonStats,
  createPokemonStatProfile,
  normalizeLevel,
  normalizePokemonStatProfile,
  normalizeStatBonuses,
} from "../pokemonStats";
import {
  ballTypes,
  type BallType,
  type Creature,
  type GamePhase,
  type GameState,
  type PokemonStatProfile,
  type RunSummary,
  type Stats,
  type TeamRecordSummary,
} from "../types";
import { getSelectedTrainerPortraitId, isValidTrainerPortraitId } from "../trainerPortraits";

export const LEGACY_TRAINER_SNAPSHOT_VERSION = 1;
export const PRE_PORTRAIT_TRAINER_SNAPSHOT_VERSION = 2;
export const TRAINER_SNAPSHOT_VERSION = 3;
export type TrainerSnapshotVersion =
  | typeof LEGACY_TRAINER_SNAPSHOT_VERSION
  | typeof PRE_PORTRAIT_TRAINER_SNAPSHOT_VERSION
  | typeof TRAINER_SNAPSHOT_VERSION;

export interface TrainerSnapshotCreature {
  creatureId: string;
  speciesId: number;
  speciesName: string;
  level?: number;
  statProfile?: PokemonStatProfile;
  statBonuses?: Stats;
  stats: Stats;
  currentHp: number;
  moves: string[];
  powerScore: number;
  rarityScore: number;
}

export interface TrainerSnapshot {
  version: typeof TRAINER_SNAPSHOT_VERSION;
  playerId: string;
  trainerName: string;
  trainerPortraitId?: string;
  wave: number;
  createdAt: string;
  seed: string;
  teamPower: number;
  team: TrainerSnapshotCreature[];
  runSummary: RunSummary;
  teamRecord?: TeamRecordSummary;
}

export interface SheetTrainerRow {
  version: TrainerSnapshotVersion;
  playerId: string;
  trainerName: string;
  wave: number;
  createdAt: string;
  seed: string;
  teamPower: number;
  teamJson: string;
  runSummaryJson: string;
  trainerPortraitId?: string;
}

export interface CreateTrainerSnapshotOptions {
  playerId: string;
  trainerName?: string;
  createdAt?: string;
  runSummary: RunSummary;
  wave?: number;
}

const validPhases: GamePhase[] = [
  "starterChoice",
  "ready",
  "captureDecision",
  "teamDecision",
  "gameOver",
];

export function createTrainerSnapshot(
  state: GameState,
  options: CreateTrainerSnapshotOptions,
): TrainerSnapshot {
  const createdAt = options.createdAt ?? new Date().toISOString();
  assertIsoDate(createdAt, "createdAt");
  const trainerPortraitId = getSelectedTrainerPortraitId(state.metaCurrency);

  return {
    version: TRAINER_SNAPSHOT_VERSION,
    playerId: requireNonEmptyString(options.playerId, "playerId"),
    trainerName: requireNonEmptyString(options.trainerName ?? state.trainerName, "trainerName"),
    trainerPortraitId,
    wave: options.wave ?? state.currentWave,
    createdAt,
    seed: state.seed,
    teamPower: scoreTeam(state.team),
    team: state.team.map(toSnapshotCreature),
    runSummary: {
      ...cloneRunSummary(options.runSummary),
      trainerPortraitId,
    },
  };
}

export function serializeTrainerSnapshot(snapshot: TrainerSnapshot): SheetTrainerRow {
  assertTrainerSnapshot(snapshot);

  return {
    version: TRAINER_SNAPSHOT_VERSION,
    playerId: snapshot.playerId,
    trainerName: snapshot.trainerName,
    wave: snapshot.wave,
    createdAt: snapshot.createdAt,
    seed: snapshot.seed,
    teamPower: snapshot.teamPower,
    teamJson: JSON.stringify(snapshot.team),
    runSummaryJson: JSON.stringify(snapshot.runSummary),
    trainerPortraitId: snapshot.trainerPortraitId,
  };
}

export function parseSheetTrainerRow(row: unknown): TrainerSnapshot {
  const source = requireRecord(row, "SheetTrainerRow");
  const version = readRequiredNumber(source, "version");

  if (
    version !== LEGACY_TRAINER_SNAPSHOT_VERSION &&
    version !== PRE_PORTRAIT_TRAINER_SNAPSHOT_VERSION &&
    version !== TRAINER_SNAPSHOT_VERSION
  ) {
    throw new Error(`Unsupported trainer row schema version: ${version}`);
  }

  const seed = readRequiredString(source, "seed");
  const team = parseJsonArray(readRequiredString(source, "teamJson"), "teamJson").map(
    (creature, index) => parseSnapshotCreature(creature, index, seed, version),
  );
  const runSummary = parseRunSummary(
    parseJsonRecord(readRequiredString(source, "runSummaryJson"), "runSummaryJson"),
  );
  const createdAt = readRequiredString(source, "createdAt");
  assertIsoDate(createdAt, "createdAt");
  readRequiredNumber(source, "teamPower");

  const snapshot: TrainerSnapshot = {
    version: TRAINER_SNAPSHOT_VERSION,
    playerId: readRequiredString(source, "playerId"),
    trainerName: readRequiredString(source, "trainerName"),
    trainerPortraitId: readOptionalTrainerPortraitId(source, "trainerPortraitId"),
    wave: readPositiveInteger(source, "wave"),
    createdAt,
    seed,
    teamPower: team.reduce((total, creature) => total + creature.powerScore, 0),
    team,
    runSummary,
  };
  assertTrainerSnapshot(snapshot);
  return snapshot;
}

export function isCheckpointWave(wave: number, checkpointInterval: number): boolean {
  return (
    Number.isInteger(wave) &&
    Number.isInteger(checkpointInterval) &&
    wave > 0 &&
    checkpointInterval > 0 &&
    wave % checkpointInterval === 0
  );
}

function toSnapshotCreature(creature: Creature): TrainerSnapshotCreature {
  return {
    creatureId: creature.instanceId,
    speciesId: creature.speciesId,
    speciesName: creature.speciesName,
    level: creature.level,
    statProfile: creature.statProfile
      ? {
          dvs: { ...creature.statProfile.dvs },
          statExp: { ...creature.statProfile.statExp },
        }
      : undefined,
    statBonuses: creature.statBonuses ? { ...creature.statBonuses } : undefined,
    stats: { ...creature.stats },
    currentHp: creature.currentHp,
    moves: creature.moves.map((move) => move.id),
    powerScore: creature.powerScore,
    rarityScore: creature.rarityScore,
  };
}

function parseSnapshotCreature(
  value: unknown,
  index: number,
  rowSeed: string,
  rowVersion: number,
): TrainerSnapshotCreature {
  const source = requireRecord(value, `team[${index}]`);
  const rawStats = parseStats(requireRecord(source.stats, `team[${index}].stats`));
  const moves = parseJsonStringArray(source.moves, `team[${index}].moves`);
  const speciesId = readPositiveInteger(source, "speciesId");
  const level =
    source.level === undefined
      ? inferSnapshotLevel(rawStats)
      : readPositiveInteger(source, "level");
  const statProfile =
    source.statProfile === undefined
      ? createPokemonStatProfile({
          seed: `${rowSeed}:snapshot:${index}`,
          speciesId,
          level,
          role: "trainer",
        })
      : normalizePokemonStatProfile(
          parseStatProfile(requireRecord(source.statProfile, `team[${index}].statProfile`)),
        );
  const statBonuses =
    source.statBonuses === undefined
      ? normalizeStatBonuses(undefined)
      : normalizeStatBonuses(
          parseNonNegativeStats(requireRecord(source.statBonuses, `team[${index}].statBonuses`)),
        );
  const species = getSpecies(speciesId);
  const stats = calculatePokemonStats(species.baseStats, level, statProfile, statBonuses);
  const rawCurrentHp = readNonNegativeNumber(source, "currentHp");
  const hpRatio = rawStats.hp <= 0 ? 1 : Math.min(1, rawCurrentHp / rawStats.hp);
  const powerScore =
    rowVersion === LEGACY_TRAINER_SNAPSHOT_VERSION || source.statProfile === undefined
      ? scoreCreature({
          stats,
          moves: moves.map((moveId) => getMove(moveId)),
          types: species.types,
        })
      : readNonNegativeNumber(source, "powerScore");

  return {
    creatureId: readRequiredString(source, "creatureId"),
    speciesId,
    speciesName: readRequiredString(source, "speciesName"),
    level,
    statProfile,
    statBonuses,
    stats,
    currentHp:
      rawCurrentHp <= 0 ? 0 : Math.max(1, Math.min(stats.hp, Math.round(stats.hp * hpRatio))),
    moves,
    powerScore,
    rarityScore: readNonNegativeNumber(source, "rarityScore"),
  };
}

function parseStatProfile(source: Record<string, unknown>): PokemonStatProfile {
  const dvs = requireRecord(source.dvs, "statProfile.dvs");
  const statExp = requireRecord(source.statExp, "statProfile.statExp");

  return {
    dvs: {
      attack: readRequiredNumber(dvs, "attack"),
      defense: readRequiredNumber(dvs, "defense"),
      speed: readRequiredNumber(dvs, "speed"),
      special: readRequiredNumber(dvs, "special"),
    },
    statExp: parseNonNegativeStats(statExp),
  };
}

function inferSnapshotLevel(stats: Stats): number {
  const total = stats.hp + stats.attack + stats.defense + stats.special + stats.speed;
  return normalizeLevel(Math.max(1, Math.round(total / 18)));
}

function parseRunSummary(source: Record<string, unknown>): RunSummary {
  const phase = readRequiredString(source, "phase") as GamePhase;

  if (!validPhases.includes(phase)) {
    throw new Error(`Invalid runSummary phase: ${phase}`);
  }

  const ballsSource = requireRecord(source.balls, "runSummary.balls");
  const balls = Object.fromEntries(
    ballTypes.map((ball) => [ball, readOptionalNonNegativeInteger(ballsSource, ball)]),
  ) as Record<BallType, number>;
  const gameOverReason =
    source.gameOverReason === undefined ? undefined : readRequiredString(source, "gameOverReason");

  return {
    seed: readRequiredString(source, "seed"),
    trainerName: readRequiredString(source, "trainerName"),
    trainerPortraitId: readOptionalTrainerPortraitId(source, "trainerPortraitId"),
    finalWave: readPositiveInteger(source, "finalWave"),
    phase,
    money: readNonNegativeNumber(source, "money"),
    balls,
    teamSize: readNonNegativeInteger(source, "teamSize"),
    teamPower: readNonNegativeNumber(source, "teamPower"),
    events: readNonNegativeInteger(source, "events"),
    gameOverReason,
  };
}

function cloneRunSummary(summary: RunSummary): RunSummary {
  return {
    ...summary,
    balls: { ...summary.balls },
  };
}

function assertTrainerSnapshot(snapshot: TrainerSnapshot): void {
  requireNonEmptyString(snapshot.playerId, "playerId");
  requireNonEmptyString(snapshot.trainerName, "trainerName");
  if (snapshot.trainerPortraitId !== undefined) {
    readTrainerPortraitId(snapshot.trainerPortraitId, "trainerPortraitId");
  }
  requireNonEmptyString(snapshot.seed, "seed");
  assertIsoDate(snapshot.createdAt, "createdAt");

  if (snapshot.version !== TRAINER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported trainer snapshot version: ${snapshot.version}`);
  }

  if (!Number.isInteger(snapshot.wave) || snapshot.wave < 1) {
    throw new Error(`Invalid trainer snapshot wave: ${snapshot.wave}`);
  }

  if (snapshot.team.length === 0) {
    throw new Error("Trainer snapshot must contain at least one team member.");
  }
}

function parseStats(source: Record<string, unknown>): Stats {
  return {
    hp: readPositiveInteger(source, "hp"),
    attack: readPositiveInteger(source, "attack"),
    defense: readPositiveInteger(source, "defense"),
    special: readPositiveInteger(source, "special"),
    speed: readPositiveInteger(source, "speed"),
  };
}

function parseNonNegativeStats(source: Record<string, unknown>): Stats {
  return {
    hp: readNonNegativeInteger(source, "hp"),
    attack: readNonNegativeInteger(source, "attack"),
    defense: readNonNegativeInteger(source, "defense"),
    special: readNonNegativeInteger(source, "special"),
    speed: readNonNegativeInteger(source, "speed"),
  };
}

function parseJsonRecord(rawJson: string, field: string): Record<string, unknown> {
  return requireRecord(parseJson(rawJson, field), field);
}

function parseJsonArray(rawJson: string, field: string): unknown[] {
  const parsed = parseJson(rawJson, field);

  if (!Array.isArray(parsed)) {
    throw new Error(`${field} must be a JSON array.`);
  }

  return parsed;
}

function parseJson(rawJson: string, field: string): unknown {
  try {
    return JSON.parse(rawJson) as unknown;
  } catch (error) {
    throw new Error(`${field} contains invalid JSON.`, { cause: error });
  }
}

function parseJsonStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length < 1)) {
    throw new Error(`${field} must be a non-empty string array.`);
  }

  return [...value];
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(source: Record<string, unknown>, field: string): string {
  return requireNonEmptyString(source[field], field);
}

function readOptionalTrainerPortraitId(
  source: Record<string, unknown>,
  field: string,
): string | undefined {
  if (source[field] === undefined || source[field] === "") {
    return undefined;
  }

  return readTrainerPortraitId(source[field], field);
}

function readTrainerPortraitId(value: unknown, field: string): string {
  const portraitId = requireNonEmptyString(value, field);

  if (!isValidTrainerPortraitId(portraitId)) {
    throw new Error(`${field} must reference a known trainer portrait.`);
  }

  return portraitId;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value;
}

function readRequiredNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }

  return value;
}

function readPositiveInteger(source: Record<string, unknown>, field: string): number {
  const value = readRequiredNumber(source, field);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return value;
}

function readNonNegativeInteger(source: Record<string, unknown>, field: string): number {
  const value = readRequiredNumber(source, field);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }

  return value;
}

function readOptionalNonNegativeInteger(source: Record<string, unknown>, field: string): number {
  if (source[field] === undefined) {
    return 0;
  }

  return readNonNegativeInteger(source, field);
}

function readNonNegativeNumber(source: Record<string, unknown>, field: string): number {
  const value = readRequiredNumber(source, field);

  if (value < 0) {
    throw new Error(`${field} must be non-negative.`);
  }

  return value;
}

function assertIsoDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-compatible date string.`);
  }
}
