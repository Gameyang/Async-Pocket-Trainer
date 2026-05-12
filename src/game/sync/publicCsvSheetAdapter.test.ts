import { describe, expect, it } from "vitest";

import { HeadlessGameClient } from "../headlessClient";
import { SeededRng } from "../rng";
import {
  createPublicSheetCsvUrl,
  parseCsvRows,
  PublicCsvTrainerAdapter,
  sheetNameFromRange,
  type PublicCsvFetchLike,
} from "./publicCsvSheetAdapter";
import {
  createTrainerSnapshot,
  serializeTrainerSnapshot,
  type SheetTrainerRow,
} from "./trainerSnapshot";

describe("PublicCsvTrainerAdapter", () => {
  it("builds public Google Sheets CSV URLs from a shared edit URL", () => {
    expect(
      createPublicSheetCsvUrl(
        "https://docs.google.com/spreadsheets/d/14ra0Y0zLORpru3nmT-obu3yD1UuO2kAJP4aJ5IIA0M4/edit?usp=sharing",
        "APT_WAVE_TEAMS",
      ),
    ).toBe(
      "https://docs.google.com/spreadsheets/d/14ra0Y0zLORpru3nmT-obu3yD1UuO2kAJP4aJ5IIA0M4/gviz/tq?tqx=out%3Acsv&sheet=APT_WAVE_TEAMS",
    );
  });

  it("extracts sheet names from range syntax", () => {
    expect(sheetNameFromRange("APT_WAVE_TEAMS!A:I")).toBe("APT_WAVE_TEAMS");
    expect(sheetNameFromRange("'Async Trainers'!A:I")).toBe("Async Trainers");
  });

  it("parses quoted CSV cells with commas and escaped quotes", () => {
    expect(parseCsvRows('"a,b","c""d",1\r\nx,y,z')).toEqual([
      ["a,b", 'c"d', "1"],
      ["x", "y", "z"],
    ]);
  });

  it("reads, filters, and picks trainer snapshots from public CSV", async () => {
    const first = buildRow("public-a", "Public A", "public-sheet-a", 5);
    const second = buildRow("public-b", "Public B", "public-sheet-b", 5);
    const otherWave = buildRow("public-c", "Public C", "public-sheet-c", 10);
    const adapter = new PublicCsvTrainerAdapter({
      csvUrl: "https://example.test/public.csv",
      fetch: createFetch(toCsv([first, second, otherWave])),
    });

    const rows = await adapter.listRows({ wave: 5, excludePlayerId: "public-a" });
    const picked = await adapter.pickSnapshot({ wave: 5 }, new SeededRng("public-pick"));

    expect(rows).toHaveLength(1);
    expect(rows[0].playerId).toBe("public-b");
    expect(picked?.wave).toBe(5);
  });

  it("rejects append in public CSV mode", async () => {
    const row = buildRow("public-a", "Public A", "public-sheet-a", 5);
    const adapter = new PublicCsvTrainerAdapter({
      csvUrl: "https://example.test/public.csv",
      fetch: createFetch(toCsv([row])),
    });

    await expect(
      adapter.appendSnapshot(buildSnapshot("public-a", "Public A", "public-sheet-a", 5)),
    ).rejects.toThrow(/read-only/);
  });
});

function createFetch(csv: string): PublicCsvFetchLike {
  return async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async text() {
      return csv;
    },
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

function buildRow(playerId: string, trainerName: string, seed: string, targetWave: number) {
  return serializeTrainerSnapshot(buildSnapshot(playerId, trainerName, seed, targetWave));
}

function buildSnapshot(playerId: string, trainerName: string, seed: string, targetWave: number) {
  const client = new HeadlessGameClient({ seed, trainerName });
  client.dispatch({ type: "START_RUN", starterSpeciesId: 1 });
  return createTrainerSnapshot(client.getSnapshot(), {
    playerId,
    createdAt: "2026-05-12T00:00:00.000Z",
    runSummary: client.getRunSummary(),
    wave: targetWave,
  });
}
