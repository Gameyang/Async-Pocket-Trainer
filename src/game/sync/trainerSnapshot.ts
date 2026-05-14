import { scoreTeam } from "../scoring";
import {
  ballTypes,
  type BallType,
  type Creature,
  type GamePhase,
  type GameState,
  type RunSummary,
  type Stats,
  type TeamRecordSummary,
} from "../types";

export const TRAINER_SNAPSHOT_VERSION = 1;

export interface TrainerSnapshotCreature {
  creatureId: string;
  speciesId: number;
  speciesName: string;
  level?: number;
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
  wave: number;
  createdAt: string;
  seed: string;
  teamPower: number;
  team: TrainerSnapshotCreature[];
  runSummary: RunSummary;
  teamRecord?: TeamRecordSummary;
}

export interface SheetTrainerRow {
  version: typeof TRAINER_SNAPSHOT_VERSION;
  playerId: string;
  trainerName: string;
  wave: number;
  createdAt: string;
  seed: string;
  teamPower: number;
  teamJson: string;
  runSummaryJson: string;
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

  return {
    version: TRAINER_SNAPSHOT_VERSION,
    playerId: requireNonEmptyString(options.playerId, "playerId"),
    trainerName: requireNonEmptyString(options.trainerName ?? state.trainerName, "trainerName"),
    wave: options.wave ?? state.currentWave,
    createdAt,
    seed: state.seed,
    teamPower: scoreTeam(state.team),
    team: state.team.map(toSnapshotCreature),
    runSummary: cloneRunSummary(options.runSummary),
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
  };
}

export function parseSheetTrainerRow(row: unknown): TrainerSnapshot {
  const source = requireRecord(row, "SheetTrainerRow");
  const version = readRequiredNumber(source, "version");

  if (version !== TRAINER_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported trainer row schema version: ${version}`);
  }

  const team = parseJsonArray(readRequiredString(source, "teamJson"), "teamJson").map(
    parseSnapshotCreature,
  );
  const runSummary = parseRunSummary(
    parseJsonRecord(readRequiredString(source, "runSummaryJson"), "runSummaryJson"),
  );
  const createdAt = readRequiredString(source, "createdAt");
  assertIsoDate(createdAt, "createdAt");

  const snapshot: TrainerSnapshot = {
    version: TRAINER_SNAPSHOT_VERSION,
    playerId: readRequiredString(source, "playerId"),
    trainerName: readRequiredString(source, "trainerName"),
    wave: readPositiveInteger(source, "wave"),
    createdAt,
    seed: readRequiredString(source, "seed"),
    teamPower: readRequiredNumber(source, "teamPower"),
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
    stats: { ...creature.stats },
    currentHp: creature.currentHp,
    moves: creature.moves.map((move) => move.id),
    powerScore: creature.powerScore,
    rarityScore: creature.rarityScore,
  };
}

function parseSnapshotCreature(value: unknown, index: number): TrainerSnapshotCreature {
  const source = requireRecord(value, `team[${index}]`);
  const stats = parseStats(requireRecord(source.stats, `team[${index}].stats`));
  const moves = parseJsonStringArray(source.moves, `team[${index}].moves`);

  return {
    creatureId: readRequiredString(source, "creatureId"),
    speciesId: readPositiveInteger(source, "speciesId"),
    speciesName: readRequiredString(source, "speciesName"),
    level:
      source.level === undefined
        ? undefined
        : readPositiveInteger(source, "level"),
    stats,
    currentHp: readNonNegativeNumber(source, "currentHp"),
    moves,
    powerScore: readNonNegativeNumber(source, "powerScore"),
    rarityScore: readNonNegativeNumber(source, "rarityScore"),
  };
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
