import { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import { getTeamHealthRatio, scoreTeam } from "../scoring";
import type {
  AutoPlayOptions,
  BallType,
  GameEvent,
  GamePhase,
  GameState,
  RunSummary,
} from "../types";
import { validateFrameContract } from "../view/frame";
import { chooseFrameAction } from "./frameController";

export interface HeadlessQaOptions {
  seed: string;
  runs: number;
  waves: number;
  strategy: AutoPlayOptions["strategy"];
}

export interface HeadlessRunReport extends RunSummary {
  invariantErrors: string[];
  healthRatio: number;
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

const ballTypes: BallType[] = ["pokeBall", "greatBall"];

export function runHeadlessQa(options: HeadlessQaOptions): HeadlessQaReport {
  const runs: HeadlessRunReport[] = [];
  const waveBalance = new Map<number, MutableWaveBalance>();

  for (let index = 0; index < options.runs; index += 1) {
    const client = new HeadlessGameClient({
      seed: `${options.seed}:${index}`,
      trainerName: `QA-${index + 1}`,
    });
    const errors: string[] = [];
    const seenEventIds = new Set<number>();
    const controllerRng = new SeededRng(`${options.seed}:${index}:controller`);
    let snapshot = client.getSnapshot();
    recordWaveSnapshot(snapshot, seenEventIds, waveBalance);

    for (let step = 0; step < options.waves * 12 + 48; step += 1) {
      errors.push(...validateState(snapshot).map((error) => `step ${step}: ${error}`));
      const frame = client.getFrame();
      errors.push(...validateFrameContract(frame).map((error) => `step ${step} frame: ${error}`));

      if (snapshot.phase === "gameOver" || snapshot.currentWave > options.waves) {
        break;
      }

      const action = chooseFrameAction(frame, options.strategy, controllerRng);

      if (!action) {
        errors.push(`step ${step}: no enabled frame action for phase ${frame.phase}`);
        break;
      }

      snapshot = client.dispatch(action.action);
      recordWaveSnapshot(snapshot, seenEventIds, waveBalance);
    }

    errors.push(...validateState(snapshot).map((error) => `final: ${error}`));
    errors.push(
      ...validateFrameContract(client.getFrame()).map((error) => `final frame: ${error}`),
    );

    runs.push({
      ...client.getRunSummary(),
      invariantErrors: errors,
      healthRatio: Number(getTeamHealthRatio(snapshot.team).toFixed(4)),
    });
  }

  const invariantErrors = runs.flatMap((run) =>
    run.invariantErrors.map((error) => `${run.seed}: ${error}`),
  );
  const completedTargetWave = runs.filter((run) => run.finalWave > options.waves).length;
  const gameOvers = runs.filter((run) => run.phase === "gameOver").length;

  return {
    options,
    aggregate: {
      runs: options.runs,
      completedTargetWave,
      gameOvers,
      averageFinalWave: average(runs.map((run) => run.finalWave)),
      averageTeamPower: average(runs.map((run) => run.teamPower)),
      averageHealthRatio: average(runs.map((run) => run.healthRatio)),
    },
    invariantErrors,
    waveBalance: toWaveBalanceReport(waveBalance),
    runs,
  };
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

    if (creature.moves.length < 1 || creature.moves.length > 4) {
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
