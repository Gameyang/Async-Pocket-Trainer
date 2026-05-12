import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import {
  GoogleSheetsTrainerAdapter,
  SHEET_TRAINER_ROW_COLUMNS,
  sheetTrainerRowToValues,
  type FetchLike,
} from "./googleSheetsAdapter";
import { createTrainerSnapshot, serializeTrainerSnapshot } from "./trainerSnapshot";

describe("GoogleSheetsTrainerAdapter", () => {
  it("appends trainer snapshots through the Google Sheets values API", async () => {
    const snapshot = buildSnapshot("google-a", "Google A", "google-sheet-a", 5);
    const row = serializeTrainerSnapshot(snapshot);
    const requests: FetchRequest[] = [];
    const adapter = new GoogleSheetsTrainerAdapter({
      spreadsheetId: "spreadsheet-1",
      range: "APT_WAVE_TEAMS!A:I",
      accessToken: "token-1",
      fetch: createFetch(requests, {}),
    });

    await expect(adapter.appendSnapshot(snapshot)).resolves.toEqual(row);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain(
      "/spreadsheets/spreadsheet-1/values/APT_WAVE_TEAMS!A%3AI:append?",
    );
    expect(requests[0].init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer token-1",
      },
    });
    expect(JSON.parse(requests[0].init.body ?? "{}")).toEqual({
      values: [sheetTrainerRowToValues(row)],
    });
  });

  it("reads, filters, parses, and picks snapshots from sheet rows", async () => {
    const first = buildSnapshot("google-a", "Google A", "google-sheet-a", 5);
    const second = buildSnapshot("google-b", "Google B", "google-sheet-b", 5);
    const old = buildSnapshot(
      "google-c",
      "Google C",
      "google-sheet-c",
      5,
      "2026-05-10T12:00:00.000Z",
    );
    const otherWave = buildSnapshot("google-d", "Google D", "google-sheet-d", 10);
    const values = [
      [...SHEET_TRAINER_ROW_COLUMNS],
      sheetTrainerRowToValues(serializeTrainerSnapshot(first)),
      sheetTrainerRowToValues(serializeTrainerSnapshot(second)),
      sheetTrainerRowToValues(serializeTrainerSnapshot(old)),
      sheetTrainerRowToValues(serializeTrainerSnapshot(otherWave)),
    ];
    const adapter = new GoogleSheetsTrainerAdapter({
      spreadsheetId: "spreadsheet-1",
      range: "APT_WAVE_TEAMS!A:I",
      apiKey: "public-key",
      fetch: createFetch([], { values }),
    });

    const rows = await adapter.listRows({
      wave: 5,
      excludePlayerId: "google-a",
      now: "2026-05-11T12:10:00.000Z",
      maxAgeMs: 30 * 60 * 1000,
    });
    const picked = await adapter.pickSnapshot({ wave: 5 }, new SeededRng("google-pick"));

    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe("google-b");
    expect(picked?.wave).toBe(5);
  });

  it("keeps game core independent from the Google-specific adapter", () => {
    const gameSources = listTypeScriptSources(join(process.cwd(), "src", "game")).filter(
      (file) =>
        !file.includes(`${join("src", "game", "sync")}${String.fromCharCode(92)}`) &&
        !file.endsWith(".test.ts"),
    );

    for (const file of gameSources) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/googleSheetsAdapter|sheets\.googleapis\.com|googleapis/);
    }
  });
});

interface FetchRequest {
  url: string;
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
}

function createFetch(requests: FetchRequest[], payload: unknown): FetchLike {
  return async (url, init = {}) => {
    requests.push({ url, init });
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      async json() {
        return payload;
      },
    };
  };
}

function buildSnapshot(
  playerId: string,
  trainerName: string,
  seed: string,
  targetWave: number,
  createdAt = "2026-05-11T12:00:00.000Z",
) {
  const client = new HeadlessGameClient({ seed, trainerName });
  client.autoStep("greedy");
  return createTrainerSnapshot(client.getSnapshot(), {
    playerId,
    createdAt,
    runSummary: client.getRunSummary(),
    wave: targetWave,
  });
}

function listTypeScriptSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return listTypeScriptSources(path);
    }

    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}
