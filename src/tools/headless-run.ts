/* eslint-disable no-console */
import { runHeadlessQa } from "../game/qa/simulate";
import { summarizeHeadlessQaReport } from "../game/qa/reportSummary";
import type { HeadlessQaTargets } from "../game/qa/simulate";
import type { AutoPlayStrategy } from "../game/types";

declare const process: {
  argv: string[];
  exitCode?: number;
};

interface CliArgs {
  seed: string;
  runs: number;
  waves: number;
  strategy: AutoPlayStrategy;
  summary: boolean;
  targets?: HeadlessQaTargets;
}

const args = parseArgs(process.argv.slice(2));
const report = await runHeadlessQa({
  seed: args.seed,
  runs: args.runs,
  waves: args.waves,
  strategy: args.strategy,
  targets: args.targets,
});

console.log(JSON.stringify(args.summary ? summarizeHeadlessQaReport(report) : report, null, 2));

if (report.invariantErrors.length > 0) {
  process.exitCode = 1;
}

if (report.targetResult && !report.targetResult.passed) {
  for (const failure of report.targetResult.failures) {
    console.error(`Balance target failed: ${failure}`);
  }
  process.exitCode = 1;
}

function parseArgs(rawArgs: string[]): CliArgs {
  const values = new Map<string, string>();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = rawArgs[index];

    if (!current.startsWith("--")) {
      continue;
    }

    const key = current.slice(2);
    const next = rawArgs[index + 1];
    values.set(key, next && !next.startsWith("--") ? next : "true");
  }

  const strategy = values.get("strategy") === "conserveBalls" ? "conserveBalls" : "greedy";

  return {
    seed: values.get("seed") ?? "qa",
    runs: parsePositiveInteger(values.get("runs"), 12),
    waves: parsePositiveInteger(values.get("waves"), 15),
    strategy,
    summary: values.get("summary") === "true",
    targets: parseTargets(values),
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseTargets(values: ReadonlyMap<string, string>): HeadlessQaTargets | undefined {
  const targets: HeadlessQaTargets = {};
  const minAverageFinalWave = parsePositiveNumber(values.get("min-average-wave"));
  const minCompletedTargetWave = parsePositiveIntegerOptional(values.get("min-completed"));
  const maxGameOvers = parsePositiveIntegerOptional(values.get("max-game-overs"));

  if (minAverageFinalWave !== undefined) {
    targets.minAverageFinalWave = minAverageFinalWave;
  }

  if (minCompletedTargetWave !== undefined) {
    targets.minCompletedTargetWave = minCompletedTargetWave;
  }

  if (maxGameOvers !== undefined) {
    targets.maxGameOvers = maxGameOvers;
  }

  return Object.keys(targets).length > 0 ? targets : undefined;
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveIntegerOptional(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}
