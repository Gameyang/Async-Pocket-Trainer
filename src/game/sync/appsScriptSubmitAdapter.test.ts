import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { sheetTrainerRowToValues } from "./googleSheetsAdapter";
import { sheetTeamBattleRecordRowToValues, type TeamBattleRecord } from "./teamBattleRecord";
import { createTrainerSnapshot, serializeTrainerSnapshot } from "./trainerSnapshot";
import { AppsScriptSubmitter, type AppsScriptFetchLike } from "./appsScriptSubmitAdapter";

describe("AppsScriptSubmitter", () => {
  it("posts trainer snapshots to a public Apps Script web app as an opaque no-cors request", async () => {
    const requests: SubmitRequest[] = [];
    const submitter = new AppsScriptSubmitter({
      submitUrl: "https://script.google.com/macros/s/deploy-id/exec",
      fetch: createFetch(requests),
    });
    const snapshot = buildSnapshot();
    const row = serializeTrainerSnapshot(snapshot);

    await expect(submitter.submitSnapshot(snapshot)).resolves.toEqual({
      ok: true,
      opaque: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://script.google.com/macros/s/deploy-id/exec",
      init: {
        method: "POST",
        mode: "no-cors",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
        },
      },
    });
    expect(JSON.parse(requests[0].init.body ?? "{}")).toMatchObject({
      ...row,
      row,
      values: sheetTrainerRowToValues(row),
      snapshot: JSON.parse(JSON.stringify(snapshot)),
    });
  });

  it("posts team battle records with sheet routing metadata", async () => {
    const requests: SubmitRequest[] = [];
    const submitter = new AppsScriptSubmitter({
      submitUrl: "https://script.google.com/macros/s/deploy-id/exec",
      fetch: createFetch(requests),
    });
    const record = buildTeamBattleRecord();

    await expect(submitter.submitTeamBattleRecord(record)).resolves.toEqual({
      ok: true,
      opaque: true,
    });

    expect(JSON.parse(requests[0].init.body ?? "{}")).toMatchObject({
      kind: "teamBattleRecord",
      sheetName: "APT_TEAM_RECORDS",
      row: record,
      values: sheetTeamBattleRecordRowToValues(record),
      record,
    });
  });
});

interface SubmitRequest {
  url: string;
  init: {
    method?: string;
    mode?: RequestMode;
    headers?: Record<string, string>;
    body?: string;
  };
}

function createFetch(requests: SubmitRequest[]): AppsScriptFetchLike {
  return async (url, init = {}) => {
    requests.push({ url, init });
    return {};
  };
}

function buildSnapshot() {
  const client = new HeadlessGameClient({
    seed: "apps-script-submit",
    trainerName: "Apps Script Tester",
  });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });

  return createTrainerSnapshot(client.getSnapshot(), {
    playerId: "player-a",
    createdAt: "2026-05-12T00:00:00.000Z",
    runSummary: client.getRunSummary(),
    wave: 5,
  });
}

function buildTeamBattleRecord(): TeamBattleRecord {
  return {
    version: 1,
    recordId: "battle-apps-script-a",
    createdAt: "2026-05-12T00:10:00.000Z",
    opponentTeamId: "team-apps-script-a",
    opponentPlayerId: "opponent-a",
    opponentTrainerName: "Apps Rival",
    opponentWave: 5,
    opponentCreatedAt: "2026-05-12T00:00:00.000Z",
    opponentSeed: "apps-rival",
    opponentTeamPower: 110,
    challengerPlayerId: "player-a",
    challengerTrainerName: "Player A",
    challengerSeed: "apps-challenger",
    battleWave: 5,
    battleWinner: "player",
    opponentResult: "loss",
    challengerTeamPower: 140,
    turns: 5,
    source: "browser",
  };
}
