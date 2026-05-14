import { SeededRng } from "../rng";
import {
  matchesTrainerRowQuery,
  type TrainerRowQuery,
  type TrainerSyncAdapter,
} from "./localSheetAdapter";
import { SHEET_TRAINER_ROW_COLUMNS, trySheetTrainerRowFromValues } from "./googleSheetsAdapter";
import {
  parseSheetTrainerRow,
  type SheetTrainerRow,
  type TrainerSnapshot,
} from "./trainerSnapshot";
import {
  matchesTeamBattleRecordQuery,
  parseSheetTeamBattleRecordRow,
  SHEET_TEAM_BATTLE_RECORD_COLUMNS,
  trySheetTeamBattleRecordRowFromValues,
  type SheetTeamBattleRecordRow,
  type TeamBattleRecord,
  type TeamBattleRecordQuery,
  type TeamRecordSyncAdapter,
} from "./teamBattleRecord";

export const DEFAULT_PUBLIC_SHEET_NAME = "APT_WAVE_TEAMS";

export interface PublicCsvTrainerAdapterOptions {
  csvUrl: string;
  teamRecordCsvUrl?: string;
  fetch?: PublicCsvFetchLike;
}

export type PublicCsvFetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
  },
) => Promise<PublicCsvResponseLike>;

export interface PublicCsvResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}

export class PublicCsvTrainerAdapter implements TrainerSyncAdapter, TeamRecordSyncAdapter {
  private readonly csvUrl: string;
  private readonly teamRecordCsvUrl?: string;
  private readonly fetchImpl: PublicCsvFetchLike;

  constructor(options: PublicCsvTrainerAdapterOptions) {
    this.csvUrl = requireNonEmpty(options.csvUrl, "csvUrl");
    this.teamRecordCsvUrl = options.teamRecordCsvUrl
      ? requireNonEmpty(options.teamRecordCsvUrl, "teamRecordCsvUrl")
      : undefined;
    this.fetchImpl = options.fetch ?? getGlobalFetch();
  }

  async appendSnapshot(_snapshot: TrainerSnapshot): Promise<SheetTrainerRow> {
    throw new Error(
      "Public CSV sheet sync is read-only. Use Google API or a submit endpoint to append.",
    );
  }

  async listRows(query: TrainerRowQuery): Promise<SheetTrainerRow[]> {
    const response = await this.fetchImpl(this.csvUrl, {
      method: "GET",
      headers: {
        Accept: "text/csv",
      },
    });

    if (!response.ok) {
      throw new Error(`공개 CSV 요청 실패: ${response.status} ${response.statusText}`);
    }

    return parseCsvRows(await response.text())
      .filter((row) => row.some((cell) => cell.trim().length > 0))
      .filter((row, index) => !isHeaderRow(row, index))
      .flatMap((rowValues) => {
        const row = trySheetTrainerRowFromValues(rowValues);
        return row ? [row] : [];
      })
      .filter((row) => matchesTrainerRowQuery(row, query))
      .map((row) => ({ ...row }));
  }

  async listSnapshots(query: TrainerRowQuery): Promise<TrainerSnapshot[]> {
    const rows = await this.listRows(query);
    return rows.map(parseSheetTrainerRow);
  }

  async pickSnapshot(query: TrainerRowQuery, rng: SeededRng): Promise<TrainerSnapshot | undefined> {
    const snapshots = await this.listSnapshots(query);

    if (snapshots.length === 0) {
      return undefined;
    }

    return rng.pick(snapshots);
  }

  async appendTeamBattleRecord(_record: TeamBattleRecord): Promise<SheetTeamBattleRecordRow> {
    throw new Error(
      "Public CSV team record sync is read-only. Use Google API or a submit endpoint to append.",
    );
  }

  async listTeamBattleRows(
    query: TeamBattleRecordQuery = {},
  ): Promise<SheetTeamBattleRecordRow[]> {
    if (!this.teamRecordCsvUrl) {
      return [];
    }

    const response = await this.fetchImpl(this.teamRecordCsvUrl, {
      method: "GET",
      headers: {
        Accept: "text/csv",
      },
    });

    if (!response.ok) {
      throw new Error(`공개 팀 기록 CSV 요청 실패: ${response.status} ${response.statusText}`);
    }

    return parseCsvRows(await response.text())
      .filter((row) => row.some((cell) => cell.trim().length > 0))
      .filter((row, index) => !isTeamRecordHeaderRow(row, index))
      .flatMap((rowValues) => {
        const row = trySheetTeamBattleRecordRowFromValues(rowValues);
        return row ? [row] : [];
      })
      .filter((row) => matchesTeamBattleRecordQuery(row, query))
      .map((row) => ({ ...row }));
  }

  async listTeamBattleRecords(query: TeamBattleRecordQuery = {}): Promise<TeamBattleRecord[]> {
    const rows = await this.listTeamBattleRows(query);
    return rows.map(parseSheetTeamBattleRecordRow);
  }
}

export function createPublicSheetCsvUrl(
  spreadsheetIdOrUrl: string,
  sheetName = DEFAULT_PUBLIC_SHEET_NAME,
): string {
  const spreadsheetId = extractSpreadsheetId(spreadsheetIdOrUrl);
  const params = new URLSearchParams({
    tqx: "out:csv",
    sheet: sheetName,
  });

  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/gviz/tq?${params.toString()}`;
}

export function extractSpreadsheetId(value: string): string {
  const trimmed = requireNonEmpty(value, "spreadsheetIdOrUrl");
  const match = trimmed.match(/\/spreadsheets\/d\/([^/]+)/);

  if (match) {
    return decodeURIComponent(match[1]);
  }

  return trimmed;
}

export function sheetNameFromRange(range: string): string {
  const firstPart = range.split("!")[0]?.trim();

  if (!firstPart) {
    return DEFAULT_PUBLIC_SHEET_NAME;
  }

  return firstPart.replace(/^'|'$/g, "");
}

export function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];

    if (inQuotes) {
      if (char === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      pushRow();

      if (csv[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    pushRow();
  }

  return rows;
}

function isHeaderRow(values: readonly string[], index: number): boolean {
  return (
    index === 0 &&
    SHEET_TRAINER_ROW_COLUMNS.every(
      (column, columnIndex) => normalizeHeader(values[columnIndex]) === column,
    )
  );
}

function isTeamRecordHeaderRow(values: readonly string[], index: number): boolean {
  return (
    index === 0 &&
    SHEET_TEAM_BATTLE_RECORD_COLUMNS.every(
      (column, columnIndex) => normalizeHeader(values[columnIndex]) === column,
    )
  );
}

function normalizeHeader(value: string | undefined): string {
  return (value ?? "").trim().replace(/,+$/g, "");
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function getGlobalFetch(): PublicCsvFetchLike {
  const fetchImpl = globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("PublicCsvTrainerAdapter requires a fetch implementation.");
  }

  return fetchImpl.bind(globalThis) as PublicCsvFetchLike;
}
