/* eslint-disable no-console */
import { CODE_APPS_SCRIPT_SUBMIT_URL } from "../browser/syncSettings";
import { AppsScriptSubmitter } from "../game/sync/appsScriptSubmitAdapter";
import { sheetTrainerRowToValues } from "../game/sync/googleSheetsAdapter";
import { createSyntheticTrainerSnapshots } from "../game/sync/syntheticTrainerSnapshots";
import { serializeTrainerSnapshot } from "../game/sync/trainerSnapshot";
import type { AutoPlayStrategy } from "../game/types";

interface CliArgs {
  seed: string;
  waves: number[];
  countPerWave: number;
  trainerNames?: string[];
  createdAt?: string;
  maxAttempts: number;
  strategy: AutoPlayStrategy;
  trainerNamePrefix: string;
  submit: boolean;
  yes: boolean;
  submitUrl?: string;
  useCodeSubmitUrl: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const snapshots = await createSyntheticTrainerSnapshots({
    seed: args.seed,
    waves: args.waves,
    countPerWave: args.countPerWave,
    trainerNames: args.trainerNames,
    createdAt: args.createdAt,
    maxAttempts: args.maxAttempts,
    strategy: args.strategy,
    trainerNamePrefix: args.trainerNamePrefix,
  });
  const rows = snapshots.map(serializeTrainerSnapshot);

  if (!args.submit) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          rows: rows.map((row) => ({
            ...row,
            values: sheetTrainerRowToValues(row),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (!args.yes) {
    throw new Error("Use --yes with --submit to confirm synthetic rows should be appended.");
  }

  const submitUrl = resolveSubmitUrl(args);
  const submitter = new AppsScriptSubmitter({
    submitUrl,
    fetch: submitFromNode,
  });

  for (const snapshot of snapshots) {
    await submitter.submitSnapshot(snapshot);
    await delay(250);
  }

  console.log(
    JSON.stringify(
      {
        mode: "submitted",
        submitted: rows.length,
        waves: args.waves,
        countPerWave: args.countPerWave,
        playerIds: rows.map((row) => row.playerId),
      },
      null,
      2,
    ),
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

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
    seed: values.get("seed") ?? "manual-synthetic",
    waves: parseWaveList(values.get("waves") ?? "5,10,15"),
    countPerWave: parsePositiveInteger(values.get("count"), 2, "count"),
    trainerNames: parseTrainerNames(values),
    createdAt: values.get("created-at"),
    maxAttempts: parsePositiveInteger(values.get("max-attempts"), 120, "max-attempts"),
    strategy: values.get("strategy") === "conserveBalls" ? "conserveBalls" : "greedy",
    trainerNamePrefix: values.get("name-prefix") ?? "테스트",
    submit: values.get("submit") === "true",
    yes: values.get("yes") === "true",
    submitUrl: values.get("submit-url") ?? process.env.APT_APPS_SCRIPT_SUBMIT_URL,
    useCodeSubmitUrl: values.get("use-code-submit-url") === "true",
  };
}

function resolveSubmitUrl(args: CliArgs): string {
  const submitUrl =
    args.submitUrl ?? (args.useCodeSubmitUrl ? CODE_APPS_SCRIPT_SUBMIT_URL : undefined);

  if (!submitUrl) {
    throw new Error(
      "Missing submit URL. Pass --submit-url, set APT_APPS_SCRIPT_SUBMIT_URL, or use --use-code-submit-url.",
    );
  }

  return submitUrl;
}

function parseWaveList(value: string): number[] {
  const waves = value
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isFinite(item));

  if (waves.length === 0) {
    throw new Error("waves must contain at least one positive integer.");
  }

  for (const wave of waves) {
    if (!Number.isInteger(wave) || wave < 1) {
      throw new Error("waves must contain only positive integers.");
    }
  }

  return waves;
}

function parsePositiveInteger(value: string | undefined, fallback: number, field: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return parsed;
}

function parseTrainerNames(values: ReadonlyMap<string, string>): string[] | undefined {
  const rawJson = values.get("names-json");

  if (rawJson) {
    const parsed = JSON.parse(rawJson) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error("names-json must be a JSON array of strings.");
    }

    return normalizeNames(parsed);
  }

  const rawNames = values.get("names");

  if (!rawNames) {
    return undefined;
  }

  return normalizeNames(rawNames.split(","));
}

function normalizeNames(values: readonly unknown[]): string[] {
  const names = values.map((value) => {
    if (typeof value !== "string") {
      throw new Error("trainer names must be strings.");
    }

    return value.trim();
  });

  if (names.length === 0 || names.some((name) => name.length === 0)) {
    throw new Error("trainer names must be non-empty strings.");
  }

  return names;
}

async function submitFromNode(
  input: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<unknown> {
  return fetch(input, {
    method: init.method,
    headers: init.headers,
    body: init.body,
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
