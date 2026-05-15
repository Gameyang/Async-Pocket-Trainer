import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../game/headlessClient";
import { LocalTrainerSheetAdapter, type TrainerRowQuery } from "../game/sync/localSheetAdapter";
import {
  createTrainerSnapshot,
  serializeTrainerSnapshot,
  type SheetTrainerRow,
  type TrainerSnapshot,
} from "../game/sync/trainerSnapshot";
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

  it("prefetches checkpoint trainers before the checkpoint and reuses the cache", async () => {
    const opponent = buildOpponentSnapshot();
    const adapter = new CountingTrainerSheetAdapter([serializeTrainerSnapshot(opponent)]);
    const client = new HeadlessGameClient({
      seed: "prefetch-checkpoint",
      trainerName: "Browser Sync",
    });
    client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
    const sync = new BrowserSyncController(client, enabledSettings, {
      adapter,
      playerId: "player-a",
      now: () => "2026-05-12T00:00:00.000Z",
    });

    await sync.prefetchNextCheckpoint();
    expect(adapter.listSnapshotWaves).toEqual([5]);

    moveClientToWave(client, 5);
    await sync.beforeDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

    expect(adapter.listSnapshotWaves).toEqual([5]);
    expect(client.getSnapshot().lastBattle?.kind).toBe("trainer");
    expect(client.getSnapshot().lastBattle?.enemyTeam[0].instanceId).toBe(
      opponent.team[0].creatureId,
    );
  });

  it("records sheet trainer battle outcomes in local cache and syncs the event log", async () => {
    const opponent = buildOpponentSnapshot();
    const adapter = new LocalTrainerSheetAdapter([serializeTrainerSnapshot(opponent)]);
    const storage = createMemoryStorage();
    const client = readyAtCheckpoint("team-record-sync");
    const sync = new BrowserSyncController(client, enabledSettings, {
      adapter,
      storage,
      playerId: "player-a",
      now: () => "2026-05-12T00:00:00.000Z",
    });

    await sync.beforeDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    await sync.afterDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    await sync.prefetchNextCheckpoint();

    const records = await adapter.listTeamBattleRecords({ challengerPlayerId: "player-a" });
    const battle = client.getSnapshot().lastBattle;

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      challengerPlayerId: "player-a",
      opponentPlayerId: "opponent-a",
      battleWinner: battle?.winner,
      opponentResult: battle?.winner === "player" ? "loss" : "win",
    });
    expect(battle?.opponentTeamRecordChange).toBeDefined();
    expect(sync.getStatus()).toMatchObject({
      state: "synced",
      pendingTeamRecordCount: 0,
    });
    expect([...storage.values.values()].some((value) => value.includes(records[0].recordId))).toBe(
      true,
    );
  });

  it("uploads a won checkpoint team and prefetches the next checkpoint trainer data", async () => {
    const waveFiveOpponent = weakenTrainerSnapshot(
      buildOpponentSnapshot({
        seed: "sheet-opponent-five",
        playerId: "opponent-five",
        wave: 5,
      }),
    );
    const waveTenOpponent = buildOpponentSnapshot({
      seed: "sheet-opponent-ten",
      playerId: "opponent-ten",
      wave: 10,
    });
    const adapter = new CountingTrainerSheetAdapter([
      serializeTrainerSnapshot(waveFiveOpponent),
      serializeTrainerSnapshot(waveTenOpponent),
    ]);
    const client = readyAtCheckpoint("auto-checkpoint-submit");
    strengthenClientTeam(client);
    const sync = new BrowserSyncController(client, enabledSettings, {
      adapter,
      playerId: "player-a",
      now: () => "2026-05-12T00:00:00.000Z",
    });

    await sync.beforeDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    client.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    const status = await sync.afterDispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });
    await sync.prefetchNextCheckpoint();

    const waveFiveRows = await adapter.listRows({ wave: 5 });

    expect(client.getSnapshot().lastBattle?.winner).toBe("player");
    expect(status).toMatchObject({ state: "synced" });
    expect(
      waveFiveRows.some((row) => row.playerId === "player-a" && row.seed === "auto-checkpoint-submit"),
    ).toBe(true);
    expect(adapter.listSnapshotWaves).toEqual(expect.arrayContaining([5, 10]));
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

class CountingTrainerSheetAdapter extends LocalTrainerSheetAdapter {
  readonly listSnapshotWaves: number[] = [];

  override async listSnapshots(query: TrainerRowQuery): Promise<TrainerSnapshot[]> {
    this.listSnapshotWaves.push(query.wave);
    return super.listSnapshots(query);
  }
}

function readyAtCheckpoint(seed: string): HeadlessGameClient {
  const client = new HeadlessGameClient({ seed, trainerName: "Browser Sync" });

  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  moveClientToWave(client, 5);

  return client;
}

function moveClientToWave(client: HeadlessGameClient, wave: number): void {
  const snapshot = client.saveSnapshot();
  snapshot.state.phase = "ready";
  snapshot.state.currentWave = wave;
  snapshot.state.selectedRoute = undefined;
  snapshot.state.pendingEncounter = undefined;
  snapshot.state.pendingCapture = undefined;
  snapshot.state.lastBattle = undefined;
  client.loadSnapshot(snapshot);
}

function strengthenClientTeam(client: HeadlessGameClient): void {
  const snapshot = client.saveSnapshot();
  snapshot.state.team = snapshot.state.team.map((creature) => ({
    ...creature,
    statBonuses: {
      hp: 900,
      attack: 900,
      defense: 900,
      special: 900,
      speed: 900,
    },
    currentHp: 999,
    powerScore: 999,
    stats: {
      hp: 999,
      attack: 999,
      defense: 999,
      special: 999,
      speed: 999,
    },
  }));
  client.loadSnapshot(snapshot);
}

function weakenTrainerSnapshot(snapshot: TrainerSnapshot): TrainerSnapshot {
  return {
    ...snapshot,
    teamPower: 1,
    team: snapshot.team.map((creature) => ({
      ...creature,
      level: 1,
      statProfile: {
        dvs: {
          attack: 0,
          defense: 0,
          speed: 0,
          special: 0,
        },
        statExp: {
          hp: 0,
          attack: 0,
          defense: 0,
          special: 0,
          speed: 0,
        },
      },
      statBonuses: {
        hp: 0,
        attack: 0,
        defense: 0,
        special: 0,
        speed: 0,
      },
      currentHp: 1,
      powerScore: 1,
      stats: {
        hp: 1,
        attack: 1,
        defense: 1,
        special: 1,
        speed: 1,
      },
    })),
  };
}

function buildOpponentSnapshot(
  options: {
    seed?: string;
    playerId?: string;
    trainerName?: string;
    starterSpeciesId?: number;
    wave?: number;
  } = {},
) {
  const {
    seed = "sheet-opponent",
    playerId = "opponent-a",
    trainerName = "Sheet Rival",
    starterSpeciesId = 4,
    wave = 5,
  } = options;
  const opponent = new HeadlessGameClient({
    seed,
    trainerName,
  });
  opponent.dispatch({ type: "START_RUN", starterSpeciesId });

  return createTrainerSnapshot(opponent.getSnapshot(), {
    playerId,
    createdAt: "2026-05-12T00:00:00.000Z",
    runSummary: opponent.getRunSummary(),
    wave,
  });
}

function toCsv(rows: readonly SheetTrainerRow[]): string {
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

function createMemoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}
