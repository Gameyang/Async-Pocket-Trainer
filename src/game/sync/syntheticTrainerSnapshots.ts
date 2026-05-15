import {
  createBrowserGameRuntime,
  createMemoryStorage,
  type BrowserGameRuntime,
} from "../../browser/gameRuntime";
import { CODE_SYNC_SETTINGS } from "../../browser/syncSettings";
import { playRenderlessGame } from "../qa/renderlessPlayer";
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
const DEFAULT_TRAINER_NAME_PREFIX = "Synthetic";

const SURNAMES = ["Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon"] as const;
const GIVEN_NAMES = ["Min", "Seo", "Jin", "Ha", "Yu", "Won", "Rin", "Sol", "Jun", "Ian"] as const;

export async function createSyntheticTrainerSnapshots(
  options: SyntheticTrainerSnapshotBatchOptions,
): Promise<TrainerSnapshot[]> {
  assertPositiveInteger(options.countPerWave, "countPerWave");

  const snapshots: TrainerSnapshot[] = [];

  for (const wave of options.waves) {
    for (let index = 0; index < options.countPerWave; index += 1) {
      snapshots.push(
        await createSyntheticTrainerSnapshot({
          ...options,
          wave,
          index,
        }),
      );
    }
  }

  return snapshots;
}

export async function createSyntheticTrainerSnapshot(
  options: SyntheticTrainerSnapshotOptions,
): Promise<TrainerSnapshot> {
  assertPositiveInteger(options.wave, "wave");
  assertNonNegativeInteger(options.index, "index");

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertPositiveInteger(maxAttempts, "maxAttempts");

  const name = createSyntheticTrainerName(options);
  const playerId = `synthetic-${sanitizeId(options.seed)}-${options.wave}-${options.index + 1}`;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const runSeed = `${options.seed}:wave-${options.wave}:slot-${options.index}:attempt-${attempt}`;
    const controllerRng = new SeededRng(`${runSeed}:controller`);
    const runtime = createBrowserGameRuntime({
      storage: createMemoryStorage(),
      seed: runSeed,
      trainerName: name,
      playerId,
      syncSettings: {
        ...CODE_SYNC_SETTINGS,
        enabled: false,
      },
      now: () => options.createdAt ?? "2026-05-15T00:00:00.000Z",
      random: () => controllerRng.nextFloat(),
      prefetchNextCheckpoint: false,
    });
    const wonState = await playUntilCheckpointWin(
      runtime,
      options.wave,
      options.strategy ?? "greedy",
      controllerRng,
    );

    if (!wonState) {
      continue;
    }

    return createTrainerSnapshot(wonState, {
      playerId,
      trainerName: name,
      createdAt: options.createdAt,
      runSummary: {
        ...runtime.getRunSummary(),
        trainerName: name,
      },
      wave: options.wave,
    });
  }

  throw new Error(
    `Could not generate a synthetic checkpoint win for wave ${options.wave} after ${maxAttempts} attempts.`,
  );
}

async function playUntilCheckpointWin(
  runtime: BrowserGameRuntime,
  targetWave: number,
  strategy: AutoPlayStrategy,
  rng: SeededRng,
): Promise<GameState | undefined> {
  const checkpointInterval = runtime.client.getBalance().checkpointInterval;

  if (!isCheckpointWave(targetWave, checkpointInterval)) {
    throw new Error(
      `Synthetic trainer snapshots can only target checkpoint waves. Wave ${targetWave} is not divisible by ${checkpointInterval}.`,
    );
  }

  const result = await playRenderlessGame(runtime, {
    maxWaves: targetWave,
    maxSteps: targetWave * 20 + 120,
    strategy,
    rng,
  });

  return isTargetCheckpointWin(result.state, targetWave) ? result.state : undefined;
}

function isTargetCheckpointWin(state: GameState, targetWave: number): boolean {
  return (
    state.phase === "ready" &&
    state.currentWave > targetWave &&
    state.lastBattle?.kind === "trainer" &&
    state.lastBattle.winner === "player"
  );
}

function createSyntheticTrainerName(options: SyntheticTrainerSnapshotOptions): string {
  const rng = new SeededRng(`${options.seed}:name:${options.wave}:${options.index}`);
  const prefix = options.trainerNamePrefix ?? DEFAULT_TRAINER_NAME_PREFIX;
  const surname = rng.pick(SURNAMES);
  const givenName = rng.pick(GIVEN_NAMES);

  return `${prefix} ${surname} ${givenName}`;
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
