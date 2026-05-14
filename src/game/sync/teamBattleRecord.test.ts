import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import {
  applyTeamBattleRecordToSummary,
  createTeamBattleRecord,
  createTeamRecordSummary,
  createTrainerTeamId,
  parseSheetTeamBattleRecordRow,
  serializeTeamBattleRecord,
  sheetTeamBattleRecordRowFromValues,
  sheetTeamBattleRecordRowToValues,
  summarizeTeamBattleRecords,
} from "./teamBattleRecord";
import { createTrainerSnapshot } from "./trainerSnapshot";

describe("team battle records", () => {
  it("serializes rows and summarizes opponent win rate with id de-duping", () => {
    const record = {
      ...buildTeamBattleRecord(),
      battleWinner: "player" as const,
      opponentResult: "loss" as const,
    };
    const row = serializeTeamBattleRecord(record);
    const values = sheetTeamBattleRecordRowToValues(row);

    expect(parseSheetTeamBattleRecordRow(row)).toEqual(record);
    expect(sheetTeamBattleRecordRowFromValues(values)).toEqual(record);
    expect(summarizeTeamBattleRecords([record, record], record.opponentTeamId)).toMatchObject({
      teamId: record.opponentTeamId,
      wins: 0,
      losses: 1,
      battles: 1,
      winRate: 0.3333,
    });
  });

  it("creates record-change projections from the opponent perspective", () => {
    const summary = createTeamRecordSummary("team-a", 2, 1);
    const lossRecord = {
      ...buildTeamBattleRecord(),
      opponentTeamId: "team-a",
      opponentResult: "loss" as const,
    };

    const change = applyTeamBattleRecordToSummary(summary, lossRecord);

    expect(change).toMatchObject({
      teamId: "team-a",
      opponentResult: "loss",
      before: { wins: 2, losses: 1 },
      after: { wins: 2, losses: 2 },
    });
    expect(change.deltaWinRate).toBeLessThan(0);
  });
});

function buildTeamBattleRecord() {
  const opponent = new HeadlessGameClient({
    seed: "team-record-opponent",
    trainerName: "Record Rival",
  });
  opponent.dispatch({ type: "START_RUN", starterSpeciesId: 4 });
  const opponentSnapshot = createTrainerSnapshot(opponent.getSnapshot(), {
    playerId: "opponent-a",
    createdAt: "2026-05-12T00:00:00.000Z",
    runSummary: opponent.getRunSummary(),
    wave: 5,
  });
  const opponentTeamId = createTrainerTeamId(opponentSnapshot);
  const challenger = new HeadlessGameClient({
    seed: "team-record-challenger",
    trainerSnapshots: [
      {
        ...opponentSnapshot,
        teamRecord: createTeamRecordSummary(opponentTeamId),
      },
    ],
  });

  challenger.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  const waveFive = challenger.saveSnapshot();
  waveFive.state.phase = "ready";
  waveFive.state.currentWave = 5;
  waveFive.state.money = 999;
  challenger.loadSnapshot(waveFive);
  challenger.dispatch({ type: "RESOLVE_NEXT_ENCOUNTER" });

  const record = createTeamBattleRecord(challenger.getSnapshot(), {
    playerId: "challenger-a",
    createdAt: "2026-05-12T00:05:00.000Z",
  });

  if (!record) {
    throw new Error("Expected team battle record.");
  }

  return record;
}
