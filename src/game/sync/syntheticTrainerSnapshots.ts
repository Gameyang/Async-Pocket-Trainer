import { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import type { AutoPlayStrategy, GameState } from "../types";
import { createTrainerSnapshot, isCheckpointWave, type TrainerSnapshot } from "./trainerSnapshot";

export interface SyntheticTrainerSnapshotOptions {
  seed: string;
  wave: number;
  index: number;
  createdAt?: string;
  maxAttempts?: number;
  strategy?: AutoPlayStrategy;
  trainerNamePrefix?: string;
}

export interface SyntheticTrainerSnapshotBatchOptions {
  seed: string;
  waves: readonly number[];
  countPerWave: number;
  createdAt?: string;
  maxAttempts?: number;
  strategy?: AutoPlayStrategy;
  trainerNamePrefix?: string;
}

const DEFAULT_MAX_ATTEMPTS = 80;
const DEFAULT_TRAINER_NAME_PREFIX = "테스트";

const KOREAN_SURNAMES = [
  "김",
  "이",
  "박",
  "최",
  "정",
  "강",
  "조",
  "윤",
  "장",
  "임",
] as const;

const KOREAN_GIVEN_NAMES = [
  "민준",
  "서준",
  "도윤",
  "예준",
  "시우",
  "하준",
  "주원",
  "지호",
  "서연",
  "서윤",
  "지우",
  "하윤",
  "민서",
  "채원",
  "지민",
  "은우",
] as const;

export function createSyntheticTrainerSnapshots(
  options: SyntheticTrainerSnapshotBatchOptions,
): TrainerSnapshot[] {
  assertPositiveInteger(options.countPerWave, "countPerWave");

  return options.waves.flatMap((wave) =>
    Array.from({ length: options.countPerWave }, (_unused, index) =>
      createSyntheticTrainerSnapshot({
        ...options,
        wave,
        index,
      }),
    ),
  );
}

export function createSyntheticTrainerSnapshot(
  options: SyntheticTrainerSnapshotOptions,
): TrainerSnapshot {
  assertPositiveInteger(options.wave, "wave");
  assertNonNegativeInteger(options.index, "index");

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertPositiveInteger(maxAttempts, "maxAttempts");

  const name = createSyntheticTrainerName(options);
  const playerId = `synthetic-${sanitizeId(options.seed)}-${options.wave}-${options.index + 1}`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const runSeed = `${options.seed}:wave-${options.wave}:slot-${options.index}:attempt-${attempt}`;
    const client = new HeadlessGameClient({
      seed: runSeed,
      trainerName: name,
    });
    const wonState = playUntilCheckpointWin(
      client,
      options.wave,
      options.strategy ?? "greedy",
    );

    if (!wonState) {
      continue;
    }

    return createTrainerSnapshot(wonState, {
      playerId,
      trainerName: name,
      createdAt: options.createdAt,
      runSummary: {
        ...client.getRunSummary(),
        trainerName: name,
      },
      wave: options.wave,
    });
  }

  throw new Error(
    `Could not generate a synthetic checkpoint win for wave ${options.wave} after ${maxAttempts} attempts.`,
  );
}

function playUntilCheckpointWin(
  client: HeadlessGameClient,
  targetWave: number,
  strategy: AutoPlayStrategy,
): GameState | undefined {
  const checkpointInterval = client.getBalance().checkpointInterval;

  if (!isCheckpointWave(targetWave, checkpointInterval)) {
    throw new Error(
      `Synthetic trainer snapshots can only target checkpoint waves. Wave ${targetWave} is not divisible by ${checkpointInterval}.`,
    );
  }

  const maxSteps = targetWave * 16 + 96;

  for (let step = 0; step < maxSteps; step += 1) {
    const before = client.getSnapshot();

    if (before.phase === "gameOver" || before.currentWave > targetWave + 1) {
      return undefined;
    }

    const after = client.autoStep(strategy);

    if (isTargetCheckpointWin(before, after, targetWave)) {
      return after;
    }
  }

  return undefined;
}

function isTargetCheckpointWin(before: GameState, after: GameState, targetWave: number): boolean {
  return (
    before.phase === "ready" &&
    before.currentWave === targetWave &&
    after.phase === "ready" &&
    after.lastBattle?.kind === "trainer" &&
    after.lastBattle.winner === "player"
  );
}

function createSyntheticTrainerName(options: SyntheticTrainerSnapshotOptions): string {
  const rng = new SeededRng(`${options.seed}:name:${options.wave}:${options.index}`);
  const prefix = options.trainerNamePrefix ?? DEFAULT_TRAINER_NAME_PREFIX;
  const surname = rng.pick(KOREAN_SURNAMES);
  const givenName = rng.pick(KOREAN_GIVEN_NAMES);

  return `${prefix} ${surname}${givenName}`;
}

function sanitizeId(value: string): string {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "trainer";
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }
}
