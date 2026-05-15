/* eslint-disable no-console */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  buildShopEconomyDataset,
  formatShopEconomyDatasetCsv,
} from "../game/qa/shopEconomyDataset";
import type { AutoPlayStrategy } from "../game/types";

declare const process: {
  argv: string[];
  exitCode?: number;
};

type OutputFormat = "json" | "csv";

interface CliArgs {
  seed: string;
  seedCount: number;
  runs: number;
  waves: number;
  strategies: AutoPlayStrategy[];
  format: OutputFormat;
  out?: string;
}

const args = parseArgs(process.argv.slice(2));
const dataset = await buildShopEconomyDataset({
  seed: args.seed,
  seedCount: args.seedCount,
  runs: args.runs,
  waves: args.waves,
  strategies: args.strategies,
});
const output =
  args.format === "csv" ? formatShopEconomyDatasetCsv(dataset) : JSON.stringify(dataset, null, 2);

if (args.out) {
  const directory = dirname(args.out);

  if (directory !== ".") {
    mkdirSync(directory, { recursive: true });
  }

  writeFileSync(args.out, output, "utf8");
  console.error(`Shop economy dataset written: ${args.out}`);
} else {
  console.log(output);
}

if (dataset.aggregate.invariantErrorCount > 0) {
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

  return {
    seed: values.get("seed") ?? "shop-economy",
    seedCount: parsePositiveInteger(values.get("seeds"), 5),
    runs: parsePositiveInteger(values.get("runs"), 24),
    waves: parsePositiveInteger(values.get("waves"), 30),
    strategies: parseStrategies(values.get("strategies") ?? values.get("strategy")),
    format: values.get("format") === "csv" ? "csv" : "json",
    out: values.get("out"),
  };
}

function parseStrategies(value: string | undefined): AutoPlayStrategy[] {
  const rawStrategies = value ? value.split(",") : ["greedy", "conserveBalls"];
  const strategies = rawStrategies
    .map((strategy) => strategy.trim())
    .filter((strategy): strategy is AutoPlayStrategy =>
      strategy === "greedy" || strategy === "conserveBalls",
    );

  return strategies.length > 0 ? [...new Set(strategies)] : ["greedy", "conserveBalls"];
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
