import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import { LocalTrainerSheetAdapter } from "./localSheetAdapter";
import {
  createTrainerSnapshot,
  isCheckpointWave,
  parseSheetTrainerRow,
  serializeTrainerSnapshot,
  type SheetTrainerRow,
} from "./trainerSnapshot";

describe("trainer snapshot sync schema", () => {
  it("serializes and parses a Google Sheets-ready trainer row", () => {
    const client = new HeadlessGameClient({
      seed: "snapshot-row",
      trainerName: "Sheet Tester",
    });
    client.autoPlay({ maxWaves: 5, strategy: "greedy" });

    const snapshot = createTrainerSnapshot(client.getSnapshot(), {
      playerId: "player-a",
      createdAt: "2026-05-11T12:00:00.000Z",
      runSummary: client.getRunSummary(),
    });
    const row = serializeTrainerSnapshot(snapshot);

    expect(row).toMatchObject({
      version: 3,
      playerId: "player-a",
      trainerName: "Sheet Tester",
      wave: snapshot.wave,
      seed: "snapshot-row",
      teamPower: snapshot.teamPower,
      trainerPortraitId: "field-scout",
    });
    expect(parseSheetTrainerRow(row)).toEqual(snapshot);
  });

  it("allows checkpoint records to override the saved team name", () => {
    const client = new HeadlessGameClient({
      seed: "snapshot-name",
      trainerName: "Original Trainer",
    });
    client.autoStep("greedy");
    const renamed = createTrainerSnapshot(client.getSnapshot(), {
      playerId: "player-name",
      trainerName: "Renamed Team",
      createdAt: "2026-05-11T12:00:00.000Z",
      runSummary: {
        ...client.getRunSummary(),
        trainerName: "Renamed Team",
      },
      wave: 5,
    });

    expect(serializeTrainerSnapshot(renamed).trainerName).toBe("Renamed Team");
  });

  it("rejects unsupported schema versions and broken JSON payloads", () => {
    const client = new HeadlessGameClient({ seed: "bad-row" });
    client.autoStep("greedy");
    const snapshot = createTrainerSnapshot(client.getSnapshot(), {
      playerId: "player-b",
      createdAt: "2026-05-11T12:00:00.000Z",
      runSummary: client.getRunSummary(),
    });
    const row = serializeTrainerSnapshot(snapshot);

    expect(() =>
      parseSheetTrainerRow({ ...row, version: 4 } satisfies Omit<SheetTrainerRow, "version"> & {
        version: number;
      }),
    ).toThrow(/Unsupported trainer row schema version/);
    expect(() => parseSheetTrainerRow({ ...row, teamJson: "{" })).toThrow(/invalid JSON/);
    expect(() => parseSheetTrainerRow({ ...row, trainerName: "" })).toThrow(/trainerName/);
  });

  it("stores, filters, and deterministically picks local sheet snapshots", async () => {
    const first = buildSnapshot("local-a", "Player A", "local-sheet-a", 5);
    const second = buildSnapshot("local-b", "Player B", "local-sheet-b", 5);
    const otherWave = buildSnapshot("local-c", "Player C", "local-sheet-c", 6);
    const adapter = new LocalTrainerSheetAdapter();

    await adapter.appendSnapshot(first);
    await adapter.appendSnapshot(second);
    await adapter.appendSnapshot(otherWave);

    const rows = await adapter.listRows({
      wave: 5,
      excludePlayerId: "local-a",
      now: "2026-05-11T12:10:00.000Z",
      maxAgeMs: 30 * 60 * 1000,
    });
    const picked = await adapter.pickSnapshot(
      { wave: 5, excludePlayerId: "local-a" },
      new SeededRng("pick-opponent"),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe("local-b");
    expect(picked?.playerId).toBe("local-b");
  });

  it("identifies configured checkpoint waves", () => {
    expect(isCheckpointWave(5, 5)).toBe(true);
    expect(isCheckpointWave(6, 5)).toBe(false);
  });

  it("migrates legacy v1 rows to official stat profiles", () => {
    const snapshot = buildSnapshot("legacy-a", "Legacy A", "legacy-sheet-a", 5);
    const row = serializeTrainerSnapshot(snapshot);
    const legacyRow = {
      ...row,
      version: 1,
      teamJson: JSON.stringify(
        snapshot.team.map(
          ({ statProfile: _statProfile, statBonuses: _statBonuses, ...creature }) => ({
            ...creature,
            stats: {
              hp: 999,
              attack: 999,
              defense: 999,
              special: 999,
              speed: 999,
            },
            currentHp: 999,
          }),
        ),
      ),
    } satisfies SheetTrainerRow;

    const migrated = parseSheetTrainerRow(legacyRow);

    expect(migrated.version).toBe(3);
    expect(migrated.team[0].statProfile).toBeDefined();
    expect(migrated.team[0].stats.hp).toBeLessThan(999);
    expect(migrated.teamPower).toBe(
      migrated.team.reduce((total, creature) => total + creature.powerScore, 0),
    );
  });
});

function buildSnapshot(playerId: string, trainerName: string, seed: string, targetWave: number) {
  const client = new HeadlessGameClient({ seed, trainerName });
  client.autoStep("greedy");
  const snapshot = createTrainerSnapshot(client.getSnapshot(), {
    playerId,
    createdAt: "2026-05-11T12:00:00.000Z",
    runSummary: client.getRunSummary(),
    wave: targetWave,
  });
  return snapshot;
}
