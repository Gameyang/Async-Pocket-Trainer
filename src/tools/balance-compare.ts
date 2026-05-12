/* eslint-disable no-console */
import { readFileSync } from "node:fs";

import { compareHeadlessQaReports } from "../game/qa/reportSummary";
import type { HeadlessQaReport } from "../game/qa/simulate";

declare const process: {
  argv: string[];
  exitCode?: number;
};

interface CompareArgs {
  before?: string;
  after?: string;
}

const args = parseArgs(process.argv.slice(2));

if (!args.before || !args.after) {
  console.error("Usage: npm run qa:compare -- --before before.json --after after.json");
  process.exitCode = 1;
} else {
  const before = readReport(args.before);
  const after = readReport(args.after);
  console.log(JSON.stringify(compareHeadlessQaReports(before, after), null, 2));
}

function parseArgs(rawArgs: string[]): CompareArgs {
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
    before: values.get("before"),
    after: values.get("after"),
  };
}

function readReport(path: string): HeadlessQaReport {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;

  if (!isHeadlessQaReport(parsed)) {
    throw new Error(`${path} is not a headless QA report.`);
  }

  return parsed;
}

function isHeadlessQaReport(value: unknown): value is HeadlessQaReport {
  return (
    typeof value === "object" &&
    value !== null &&
    "options" in value &&
    "aggregate" in value &&
    "waveBalance" in value &&
    "runs" in value
  );
}
