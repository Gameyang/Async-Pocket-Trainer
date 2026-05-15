import { createBrowserGameRuntime, createMemoryStorage } from "../../browser/gameRuntime";
import { CODE_SYNC_SETTINGS } from "../../browser/syncSettings";
import type { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import { getTeamHealthRatio, scoreTeam } from "../scoring";
import {
  createTrainerSnapshot,
  isCheckpointWave,
  parseSheetTrainerRow,
  serializeTrainerSnapshot,
} from "../sync/trainerSnapshot";
import { ballTypes } from "../types";
import type { AutoPlayStrategy, GameEvent, GamePhase, GameState, RunSummary } from "../types";
import { validateFrameContract } from "../view/frame";
import type { RenderlessActionTraceEntry, RenderlessTerminalReason } from "./renderlessPlayer";
import { playRenderlessGame } from "./renderlessPlayer";

export interface HeadlessQaOptions {
  seed: string;
  runs: number;
  waves: number;
  strategy: AutoPlayStrategy;
  targets?: HeadlessQaTargets;
}

export interface HeadlessQaTargets {
  minAverageFinalWave?: number;
  minCompletedTargetWave?: number;
  maxGameOvers?: number;
}

export interface HeadlessQaTargetResult {
  passed: boolean;
  failures: string[];
  minAverageFinalWave?: {
    target: number;
    actual: number;
    passed: boolean;
  };
  minCompletedTargetWave?: {
    target: number;
    actual: number;
    passed: boolean;
  };
  maxGameOvers?: {
    target: number;
    actual: number;
    passed: boolean;
  };
}

export interface HeadlessRunReport extends RunSummary {
  invariantErrors: string[];
  healthRatio: number;
  terminalReason: RenderlessTerminalReason;
  steps: number;
  actionTrace: RenderlessActionTraceEntry[];
}

export interface HeadlessQaReport {
  options: HeadlessQaOptions;
  aggregate: {
    runs: number;
    completedTargetWave: number;
    gameOvers: number;
    averageFinalWave: number;
    averageTeamPower: number;
    averageHealthRatio: number;
  };
  targetResult?: HeadlessQaTargetResult;
  invariantErrors: string[];
  waveBalance: WaveBalanceReport[];
  runs: HeadlessRunReport[];
}

export interface WaveBalanceReport {
  wave: number;
  samples: number;
  battleResults: number;
  battleWins: number;
  battleLosses: number;
  deaths: number;
  captureAttempts: number;
  captureSuccesses: number;
  captureSuccessRate: number;
  captureKeeps: number;
  captureReleases: number;
  rests: number;
  ballPurchases: number;
  averageTeamPower: number;
  teamPowerDistribution: NumericDistribution;
  averageHealthRatio: number;
  averageTeamSize: number;
  topGameOverReasons: Array<{
    reason: string;
    count: number;
  }>;
}

export interface NumericDistribution {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

interface MutableWaveBalance {
  wave: number;
  samples: number;
  teamPowerTotal: number;
  teamPowers: number[];
  healthRatioTotal: number;
  teamSizeTotal: number;
  battleResults: number;
  battleWins: number;
  battleLosses: number;
  deaths: number;
  captureAttempts: number;
  captureSuccesses: number;
  captureKeeps: number;
  captureReleases: number;
  rests: number;
  ballPurchases: number;
  gameOverReasons: Map<string, number>;
}

const validPhases: GamePhase[] = [
  "starterChoice",
  "ready",
  "captureDecision",
  "teamDecision",
  "gameOver",
];

export async function runHeadlessQa(options: HeadlessQaOptions): Promise<HeadlessQaReport> {
  const runs: HeadlessRunReport[] = [];
  const waveBalance = new Map<number, MutableWaveBalance>();

  for (let index = 0; index < options.runs; index += 1) {
    const controllerRng = new SeededRng(`${options.seed}:${index}:controller`);
    const runtime = createBrowserGameRuntime({
      storage: createMemoryStorage(),
      seed: `${options.seed}:${index}`,
      trainerName: `QA-${index + 1}`,
      playerId: `qa-${index + 1}`,
      syncSettings: {
        ...CODE_SYNC_SETTINGS,
        enabled: false,
      },
      now: () => "2026-05-12T00:00:00.000Z",
      random: () => controllerRng.nextFloat(),
      prefetchNextCheckpoint: false,
    });
    const client = runtime.client;
    const errors: string[] = [];
    const seenEventIds = new Set<number>();
    const seenCheckpointWaves = new Set<number>();
    let snapshot = runtime.getSnapshot();
    recordWaveSnapshot(snapshot, seenEventIds, waveBalance);
    errors.push(
      ...validateCheckpointSnapshot(client, snapshot, seenCheckpointWaves).map(
        (error) => `initial checkpoint: ${error}`,
      ),
    );

    const playResult = await playRenderlessGame(runtime, {
      maxWaves: options.waves,
      strategy: options.strategy,
      rng: controllerRng,
      onFrame(step, frame, state) {
        errors.push(...validateState(state).map((error) => `step ${step}: ${error}`));
        errors.push(...validateFrameContract(frame).map((error) => `step ${step} frame: ${error}`));
      },
      onState(step, state) {
        snapshot = state;
        recordWaveSnapshot(snapshot, seenEventIds, waveBalance);
        errors.push(
          ...validateCheckpointSnapshot(client, snapshot, seenCheckpointWaves).map(
            (error) => `step ${step} checkpoint: ${error}`,
          ),
        );
      },
    });
    snapshot = playResult.state;

    if (
      playResult.terminalReason === "noEnabledAction" ||
      playResult.terminalReason === "noDispatchablePayload" ||
      playResult.terminalReason === "maxSteps"
    ) {
      errors.push(`terminal: ${playResult.terminalReason}`);
    }

    errors.push(...validateState(snapshot).map((error) => `final: ${error}`));
    errors.push(
      ...validateFrameContract(runtime.getFrame()).map((error) => `final frame: ${error}`),
    );

    runs.push({
      ...client.getRunSummary(),
      invariantErrors: errors,
      healthRatio: Number(getTeamHealthRatio(snapshot.team).toFixed(4)),
      terminalReason: playResult.terminalReason,
      steps: playResult.steps,
      actionTrace: playResult.actionTrace.slice(-12),
    });
  }

  const invariantErrors = runs.flatMap((run) =>
    run.invariantErrors.map((error) => `${run.seed}: ${error}`),
  );
  const completedTargetWave = runs.filter((run) => run.finalWave > options.waves).length;
  const gameOvers = runs.filter((run) => run.phase === "gameOver").length;
  const aggregate = {
    runs: options.runs,
    completedTargetWave,
    gameOvers,
    averageFinalWave: average(runs.map((run) => run.finalWave)),
    averageTeamPower: average(runs.map((run) => run.teamPower)),
    averageHealthRatio: average(runs.map((run) => run.healthRatio)),
  };

  return {
    options,
    aggregate,
    targetResult: evaluateTargets(options.targets, aggregate),
    invariantErrors,
    waveBalance: toWaveBalanceReport(waveBalance),
    runs,
  };
}

function evaluateTargets(
  targets: HeadlessQaTargets | undefined,
  aggregate: HeadlessQaReport["aggregate"],
): HeadlessQaTargetResult | undefined {
  if (!targets) {
    return undefined;
  }

  const result: HeadlessQaTargetResult = {
    passed: true,
    failures: [],
  };

  if (targets.minAverageFinalWave !== undefined) {
    const passed = aggregate.averageFinalWave >= targets.minAverageFinalWave;
    result.minAverageFinalWave = {
      target: targets.minAverageFinalWave,
      actual: aggregate.averageFinalWave,
      passed,
    };
    recordTargetResult(
      result,
      passed,
      `averageFinalWave ${aggregate.averageFinalWave} is below ${targets.minAverageFinalWave}`,
    );
  }

  if (targets.minCompletedTargetWave !== undefined) {
    const passed = aggregate.completedTargetWave >= targets.minCompletedTargetWave;
    result.minCompletedTargetWave = {
      target: targets.minCompletedTargetWave,
      actual: aggregate.completedTargetWave,
      passed,
    };
    recordTargetResult(
      result,
      passed,
      `completedTargetWave ${aggregate.completedTargetWave} is below ${targets.minCompletedTargetWave}`,
    );
  }

  if (targets.maxGameOvers !== undefined) {
    const passed = aggregate.gameOvers <= targets.maxGameOvers;
    result.maxGameOvers = {
      target: targets.maxGameOvers,
      actual: aggregate.gameOvers,
      passed,
    };
    recordTargetResult(
      result,
      passed,
      `gameOvers ${aggregate.gameOvers} is above ${targets.maxGameOvers}`,
    );
  }

  return result;
}

function recordTargetResult(
  result: HeadlessQaTargetResult,
  passed: boolean,
  failure: string,
): void {
  if (passed) {
    return;
  }

  result.passed = false;
  result.failures.push(failure);
}

export function validateState(state: GameState): string[] {
  const errors: string[] = [];

  if (state.version !== 1) {
    errors.push(`unsupported state version ${state.version}`);
  }

  if (!validPhases.includes(state.phase)) {
    errors.push(`invalid phase ${state.phase}`);
  }

  if (!Number.isInteger(state.currentWave) || state.currentWave < 1) {
    errors.push(`invalid currentWave ${state.currentWave}`);
  }

  if (state.money < 0) {
    errors.push(`money is negative: ${state.money}`);
  }

  for (const ball of ballTypes) {
    if (!Number.isInteger(state.balls[ball]) || state.balls[ball] < 0) {
      errors.push(`${ball} count is invalid: ${state.balls[ball]}`);
    }
  }

  if (state.phase !== "starterChoice" && state.team.length < 1) {
    errors.push("active run has no team");
  }

  if (state.team.length > 6) {
    errors.push(`team has too many members: ${state.team.length}`);
  }

  for (const creature of state.team) {
    if (creature.currentHp < 0 || creature.currentHp > creature.stats.hp) {
      errors.push(
        `${creature.speciesName} hp out of range: ${creature.currentHp}/${creature.stats.hp}`,
      );
    }

    if (creature.moves.length !== 2) {
      errors.push(`${creature.speciesName} has invalid move count: ${creature.moves.length}`);
    }
  }

  if (state.phase === "captureDecision" && !state.pendingEncounter) {
    errors.push("captureDecision phase has no pending encounter");
  }

  if (state.phase === "teamDecision" && !state.pendingCapture) {
    errors.push("teamDecision phase has no pending capture");
  }

  if (state.phase === "gameOver" && !state.gameOverReason) {
    errors.push("gameOver phase has no reason");
  }

  if (scoreTeam(state.team) < 0) {
    errors.push("team power cannot be negative");
  }

  return errors;
}

function validateCheckpointSnapshot(
  client: HeadlessGameClient,
  state: GameState,
  seenCheckpointWaves: Set<number>,
): string[] {
  if (
    state.phase !== "ready" ||
    seenCheckpointWaves.has(state.currentWave) ||
    !isCheckpointWave(state.currentWave, client.getBalance().checkpointInterval)
  ) {
    return [];
  }

  seenCheckpointWaves.add(state.currentWave);

  try {
    const snapshot = createTrainerSnapshot(state, {
      playerId: `qa-${state.seed}`,
      createdAt: "2026-05-12T00:00:00.000Z",
      runSummary: client.getRunSummary(),
    });
    const row = serializeTrainerSnapshot(snapshot);
    const parsed = parseSheetTrainerRow(row);

    if (JSON.stringify(parsed) !== JSON.stringify(snapshot)) {
      return [`checkpoint snapshot round-trip changed at wave ${state.currentWave}`];
    }

    return [];
  } catch (error) {
    return [
      `checkpoint snapshot failed at wave ${state.currentWave}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Number((values.reduce((total, value) => total + value, 0) / values.length).toFixed(2));
}

function recordWaveSnapshot(
  state: GameState,
  seenEventIds: Set<number>,
  waveBalance: Map<number, MutableWaveBalance>,
): void {
  if (state.phase !== "starterChoice") {
    const bucket = getWaveBucket(waveBalance, state.currentWave);
    bucket.samples += 1;
    const teamPower = scoreTeam(state.team);
    bucket.teamPowerTotal += teamPower;
    bucket.teamPowers.push(teamPower);
    bucket.healthRatioTotal += getTeamHealthRatio(state.team);
    bucket.teamSizeTotal += state.team.length;
  }

  for (const event of state.events) {
    if (seenEventIds.has(event.id)) {
      continue;
    }

    seenEventIds.add(event.id);
    recordWaveEvent(event, getWaveBucket(waveBalance, event.wave));
  }
}

function recordWaveEvent(event: GameEvent, bucket: MutableWaveBalance): void {
  if (event.type === "battle_resolved") {
    bucket.battleResults += 1;

    if (event.data?.winner === "player") {
      bucket.battleWins += 1;
    } else if (event.data?.winner === "enemy") {
      bucket.battleLosses += 1;
    }
  }

  if (event.type === "game_over") {
    bucket.deaths += 1;
    bucket.gameOverReasons.set(event.message, (bucket.gameOverReasons.get(event.message) ?? 0) + 1);
  }

  if (event.type === "capture_attempted") {
    bucket.captureAttempts += 1;

    if (event.data?.success === true) {
      bucket.captureSuccesses += 1;
    }
  }

  if (event.type === "capture_kept") {
    bucket.captureKeeps += 1;
  }

  if (event.type === "capture_released") {
    bucket.captureReleases += 1;
  }

  if (event.type === "team_rested") {
    bucket.rests += 1;
  }

  if (event.type === "ball_bought") {
    bucket.ballPurchases += 1;
  }
}

function getWaveBucket(
  waveBalance: Map<number, MutableWaveBalance>,
  wave: number,
): MutableWaveBalance {
  const existing = waveBalance.get(wave);

  if (existing) {
    return existing;
  }

  const created: MutableWaveBalance = {
    wave,
    samples: 0,
    teamPowerTotal: 0,
    teamPowers: [],
    healthRatioTotal: 0,
    teamSizeTotal: 0,
    battleResults: 0,
    battleWins: 0,
    battleLosses: 0,
    deaths: 0,
    captureAttempts: 0,
    captureSuccesses: 0,
    captureKeeps: 0,
    captureReleases: 0,
    rests: 0,
    ballPurchases: 0,
    gameOverReasons: new Map<string, number>(),
  };
  waveBalance.set(wave, created);
  return created;
}

function toWaveBalanceReport(
  waveBalance: ReadonlyMap<number, MutableWaveBalance>,
): WaveBalanceReport[] {
  return [...waveBalance.values()]
    .sort((left, right) => left.wave - right.wave)
    .map((bucket) => ({
      wave: bucket.wave,
      samples: bucket.samples,
      battleResults: bucket.battleResults,
      battleWins: bucket.battleWins,
      battleLosses: bucket.battleLosses,
      deaths: bucket.deaths,
      captureAttempts: bucket.captureAttempts,
      captureSuccesses: bucket.captureSuccesses,
      captureSuccessRate:
        bucket.captureAttempts === 0
          ? 0
          : Number((bucket.captureSuccesses / bucket.captureAttempts).toFixed(4)),
      captureKeeps: bucket.captureKeeps,
      captureReleases: bucket.captureReleases,
      rests: bucket.rests,
      ballPurchases: bucket.ballPurchases,
      averageTeamPower: averageFromTotal(bucket.teamPowerTotal, bucket.samples),
      teamPowerDistribution: toDistribution(bucket.teamPowers),
      averageHealthRatio: averageFromTotal(bucket.healthRatioTotal, bucket.samples, 4),
      averageTeamSize: averageFromTotal(bucket.teamSizeTotal, bucket.samples),
      topGameOverReasons: [...bucket.gameOverReasons.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([reason, count]) => ({ reason, count })),
    }));
}

function averageFromTotal(total: number, count: number, precision = 2): number {
  if (count === 0) {
    return 0;
  }

  return Number((total / count).toFixed(precision));
}

function toDistribution(values: readonly number[]): NumericDistribution {
  if (values.length === 0) {
    return { min: 0, p25: 0, median: 0, p75: 0, max: 0 };
  }

  const sorted = [...values].sort((left, right) => left - right);

  return {
    min: sorted[0],
    p25: percentile(sorted, 0.25),
    median: percentile(sorted, 0.5),
    p75: percentile(sorted, 0.75),
    max: sorted[sorted.length - 1],
  };
}

function percentile(sortedValues: readonly number[], ratio: number): number {
  const index = Math.min(sortedValues.length - 1, Math.floor((sortedValues.length - 1) * ratio));
  return sortedValues[index];
}
