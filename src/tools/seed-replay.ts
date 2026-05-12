/* eslint-disable no-console */
import { summarizeHeadlessQaReport } from "../game/qa/reportSummary";
import { runHeadlessQa } from "../game/qa/simulate";
import type { AutoPlayStrategy } from "../game/types";

declare const process: {
  argv: string[];
  exitCode?: number;
};

interface ReplayArgs {
  seed: string;
  runs: number;
  waves: number;
  strategy: AutoPlayStrategy;
}

const args = parseArgs(process.argv.slice(2));
const first = runHeadlessQa(args);
const second = runHeadlessQa(args);
const deterministic = JSON.stringify(first) === JSON.stringify(second);

console.log(
  JSON.stringify(
    {
      options: args,
      deterministic,
      first: summarizeHeadlessQaReport(first),
      second: summarizeHeadlessQaReport(second),
    },
    null,
    2,
  ),
);

if (!deterministic || first.invariantErrors.length > 0 || second.invariantErrors.length > 0) {
  process.exitCode = 1;
}

function parseArgs(rawArgs: string[]): ReplayArgs {
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

  return {
    seed: values.get("seed") ?? "replay",
    runs: parsePositiveInteger(values.get("runs"), 12),
    waves: parsePositiveInteger(values.get("waves"), 15),
    strategy: values.get("strategy") === "conserveBalls" ? "conserveBalls" : "greedy",
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
