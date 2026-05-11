import { HeadlessGameClient } from "../headlessClient";
import { getTeamHealthRatio, scoreTeam } from "../scoring";
import type { AutoPlayOptions, BallType, GamePhase, GameState, RunSummary } from "../types";
import { validateFrameContract } from "../view/frame";

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
  runs: HeadlessRunReport[];
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

  for (let index = 0; index < options.runs; index += 1) {
    const client = new HeadlessGameClient({
      seed: `${options.seed}:${index}`,
      trainerName: `QA-${index + 1}`,
    });
    const errors: string[] = [];
    let snapshot = client.getSnapshot();

    for (let step = 0; step < options.waves * 8 + 24; step += 1) {
      errors.push(...validateState(snapshot).map((error) => `step ${step}: ${error}`));
      errors.push(
        ...validateFrameContract(client.getFrame()).map((error) => `step ${step} frame: ${error}`),
      );

      if (snapshot.phase === "gameOver" || snapshot.currentWave > options.waves) {
        break;
      }

      snapshot = client.autoStep(options.strategy);
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
