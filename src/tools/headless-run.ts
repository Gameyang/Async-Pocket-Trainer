/* eslint-disable no-console */
import { runHeadlessQa } from "../game/qa/simulate";
import type { AutoPlayOptions } from "../game/types";

declare const process: {
  argv: string[];
  exitCode?: number;
};

interface CliArgs {
  seed: string;
  runs: number;
  waves: number;
  strategy: AutoPlayOptions["strategy"];
}

const args = parseArgs(process.argv.slice(2));
const report = runHeadlessQa(args);

console.log(JSON.stringify(report, null, 2));

if (report.invariantErrors.length > 0) {
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
  };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
