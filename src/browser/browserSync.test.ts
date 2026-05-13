import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import { LocalTrainerSheetAdapter } from "../game/sync/localSheetAdapter";
import { createTrainerSnapshot, serializeTrainerSnapshot } from "../game/sync/trainerSnapshot";
import { BrowserSyncController } from "./browserSync";
import type { SyncSettings } from "./syncSettings";

const enabledSettings: SyncSettings = {
  enabled: true,
  mode: "googleApi",
  spreadsheetId: "sheet-1",
  range: "APT_WAVE_TEAMS!A:I",
  apiKey: "key-1",
};

describe("browser sync controller", () => {
  it("appends checkpoint snapshots through the configured adapter", async () => {
    const client = readyAtCheckpoint("append-checkpoint");
    const adapter = new LocalTrainerSheetAdapter();
    const sync = new BrowserSyncController(client, enabledSettings, {
      adapter,
      playerId: "player-a",
      now: () => "2026-05-12T00:00:00.000Z",
    });

    await sync.submitCheckpointRecord({ wave: 5 });

    const rows = await adapter.listRows({ wave: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      playerId: "player-a",
      wave: 5,
      seed: "append-checkpoint",
    });
    expect(sync.getStatus()).toMatchObject({ state: "synced" });
  });

  it("loads and injects a picked trainer snapshot before a checkpoint encounter", async () => {
    const opponent = buildOpponentSnapshot();
    const adapter = new LocalTrainerSheetAdapter([serializeTrainerSnapshot(opponent)]);
    const client = readyAtCheckpoint("pick-checkpoint");
    const sync = new BrowserSyncController(client, enabledSettings, {
      adapter,
      playerId: "player-a",
      now: () => "2026-05-12T00:00:00.000Z",
    });

    await sync.beforeDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(client.getSnapshot().lastBattle?.kind).toBe("trainer");
    expect(client.getSnapshot().lastBattle?.enemyTeam[0].instanceId).toBe(
      opponent.team[0].creatureId,
    );
    expect(sync.getStatus()).toMatchObject({ state: "synced", candidateCount: 1 });
  });

  it("stays offline when sync is enabled without credentials", async () => {
    const client = readyAtCheckpoint("offline-sync");
    const sync = new BrowserSyncController(
      client,
      {
        enabled: true,
        mode: "googleApi",
        spreadsheetId: "sheet-1",
        range: "APT_WAVE_TEAMS!A:I",
      },
      { playerId: "player-a" },
    );

    await sync.beforeDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(sync.getStatus()).toMatchObject({ state: "offline" });
  });

  it("loads public CSV candidates and reports missing submit URL for checkpoint records", async () => {
    const opponent = buildOpponentSnapshot();
    const csv = toCsv([serializeTrainerSnapshot(opponent)]);
    const client = readyAtCheckpoint("public-csv-sync");
    const requests: FetchRequest[] = [];
    const sync = new BrowserSyncController(
      client,
      {
        enabled: true,
        mode: "publicCsv",
        spreadsheetId: "sheet-1",
        range: "APT_WAVE_TEAMS!A:I",
      },
      {
        playerId: "player-a",
        now: () => "2026-05-12T00:00:00.000Z",
        fetch: async (url, init = {}) => {
          requests.push({ url, init });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            async json() {
              return {};
            },
            async text() {
              return csv;
            },
          };
        },
      },
    );

    await sync.submitCheckpointRecord({ wave: 5 });
    expect(sync.getStatus().message).toContain("제출 URL");
    expect(requests.some((request) => request.init.method === "POST")).toBe(false);

    await sync.beforeDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(client.getSnapshot().lastBattle?.enemyTeam[0].instanceId).toBe(
      opponent.team[0].creatureId,
    );
  });

  it("submits public CSV checkpoints through Apps Script when a submit URL is configured", async () => {
    const requests: FetchRequest[] = [];
    const client = readyAtCheckpoint("public-csv-submit");
    const sync = new BrowserSyncController(
      client,
      {
        enabled: true,
        mode: "publicCsv",
        spreadsheetId: "sheet-1",
        range: "APT_WAVE_TEAMS!A:I",
        appsScriptSubmitUrl: "https://script.google.com/macros/s/deploy-id/exec",
      },
      {
        playerId: "player-a",
        now: () => "2026-05-12T00:00:00.000Z",
        fetch: async (url, init = {}) => {
          requests.push({ url, init });
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            async json() {
              return {};
            },
            async text() {
              return "";
            },
          };
        },
      },
    );

    expect(sync.getStatus().message).toContain("Apps Script 준비됨");

    await sync.submitCheckpointRecord({ wave: 5 });

    const post = requests.find((request) => request.init.method === "POST");
    expect(post?.url).toBe("https://script.google.com/macros/s/deploy-id/exec");
    expect(post?.init.mode).toBe("no-cors");
    const body = JSON.parse(post?.init.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      playerId: "player-a",
      wave: 5,
      seed: "public-csv-submit",
    });
    expect(body.snapshot).toMatchObject({
      playerId: "player-a",
      wave: 5,
      seed: "public-csv-submit",
    });
    expect(body.values).toEqual(expect.arrayContaining(["player-a", "5", "public-csv-submit"]));
    expect(sync.getStatus().message).toContain("Apps Script 제출 완료");
  });
});

interface FetchRequest {
  url: string;
  init: {
    method?: string;
    mode?: RequestMode;
    headers?: Record<string, string>;
    body?: string;
  };
}

function readyAtCheckpoint(seed: string): HeadlessGameClient {
  const client = new HeadlessGameClient({ seed, trainerName: "Browser Sync" });

  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });

  for (let guard = 0; guard < 30; guard += 1) {
    const state = client.getSnapshot();

    if (state.phase === "ready" && state.currentWave === 5) {
      return client;
    }

    const action =
      client.getFrame().actions.find((candidate) => candidate.id === "encounter:next") ??
      client.getFrame().actions.find((candidate) => candidate.enabled);

    if (!action) {
      throw new Error(`No action while preparing checkpoint from ${state.phase}.`);
    }

    client.dispatch(action.action);
  }

  throw new Error("Could not reach checkpoint wave 5.");
}

function buildOpponentSnapshot() {
  const opponent = new HeadlessGameClient({
    seed: "sheet-opponent",
    trainerName: "Sheet Rival",
  });
  opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });

  return createTrainerSnapshot(opponent.getSnapshot(), {
    playerId: "opponent-a",
    createdAt: "2026-05-12T00:00:00.000Z",
    runSummary: opponent.getRunSummary(),
    wave: 5,
  });
}

function toCsv(rows: readonly ReturnType<typeof serializeTrainerSnapshot>[]): string {
  const headers = [
    "version",
    "playerId",
    "trainerName",
    "wave",
    "createdAt",
    "seed",
    "teamPower",
    "teamJson",
    "runSummaryJson",
  ];
  return [headers, ...rows.map((row) => Object.values(row).map(String))]
    .map((row) => row.map(csvCell).join(","))
    .join("\n");
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
