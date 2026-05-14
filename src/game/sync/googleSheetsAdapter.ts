import { SeededRng } from "../rng";
import {
  matchesTrainerRowQuery,
  type TrainerRowQuery,
  type TrainerSyncAdapter,
} from "./localSheetAdapter";
import {
  parseSheetTrainerRow,
  serializeTrainerSnapshot,
  type SheetTrainerRow,
  type TrainerSnapshot,
} from "./trainerSnapshot";
import {
  DEFAULT_TEAM_BATTLE_RECORD_RANGE,
  matchesTeamBattleRecordQuery,
  parseSheetTeamBattleRecordRow,
  serializeTeamBattleRecord,
  SHEET_TEAM_BATTLE_RECORD_COLUMNS,
  sheetTeamBattleRecordRowFromValues,
  sheetTeamBattleRecordRowToValues,
  type SheetTeamBattleRecordRow,
  type TeamBattleRecord,
  type TeamBattleRecordQuery,
  type TeamRecordSyncAdapter,
} from "./teamBattleRecord";

export const SHEET_TRAINER_ROW_COLUMNS = [
  "version",
  "playerId",
  "trainerName",
  "wave",
  "createdAt",
  "seed",
  "teamPower",
  "teamJson",
  "runSummaryJson",
] as const;

export interface GoogleSheetsTrainerAdapterOptions {
  spreadsheetId: string;
  range: string;
  teamRecordRange?: string;
  apiKey?: string;
  accessToken?: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponseLike>;

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

export class GoogleSheetsTrainerAdapter implements TrainerSyncAdapter, TeamRecordSyncAdapter {
  private readonly spreadsheetId: string;
  private readonly range: string;
  private readonly teamRecordRange: string;
  private readonly apiKey?: string;
  private readonly accessToken?: string;
  private readonly fetchImpl: FetchLike;
  private readonly baseUrl: string;

  constructor(options: GoogleSheetsTrainerAdapterOptions) {
    this.spreadsheetId = requireNonEmpty(options.spreadsheetId, "spreadsheetId");
    this.range = requireNonEmpty(options.range, "range");
    this.teamRecordRange = requireNonEmpty(
      options.teamRecordRange ?? DEFAULT_TEAM_BATTLE_RECORD_RANGE,
      "teamRecordRange",
    );
    this.apiKey = options.apiKey;
    this.accessToken = options.accessToken;
    this.fetchImpl = options.fetch ?? getGlobalFetch();
    this.baseUrl = options.baseUrl ?? "https://sheets.googleapis.com/v4";

    if (!this.apiKey && !this.accessToken) {
      throw new Error("GoogleSheetsTrainerAdapter requires apiKey or accessToken.");
    }
  }

  async appendSnapshot(snapshot: TrainerSnapshot): Promise<SheetTrainerRow> {
    const row = serializeTrainerSnapshot(snapshot);
    const url = this.createValuesUrl(`${this.encodedRange()}:append`, {
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
    });
    await this.requestJson(url, {
      method: "POST",
      body: JSON.stringify({
        values: [sheetTrainerRowToValues(row)],
      }),
    });
    return { ...row };
  }

  async listRows(query: TrainerRowQuery): Promise<SheetTrainerRow[]> {
    const url = this.createValuesUrl(this.encodedRange(), {
      majorDimension: "ROWS",
    });
    const payload = await this.requestJson(url);
    const values = parseValuesResponse(payload);

    return values
      .filter((rowValues, index) => !isHeaderRow(rowValues, index))
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

  async appendTeamBattleRecord(
    record: TeamBattleRecord,
  ): Promise<SheetTeamBattleRecordRow> {
    const row = serializeTeamBattleRecord(record);
    const url = this.createValuesUrl(`${this.encodedTeamRecordRange()}:append`, {
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
    });
    await this.requestJson(url, {
      method: "POST",
      body: JSON.stringify({
        values: [sheetTeamBattleRecordRowToValues(row)],
      }),
    });
    return { ...row };
  }

  async listTeamBattleRows(
    query: TeamBattleRecordQuery = {},
  ): Promise<SheetTeamBattleRecordRow[]> {
    const url = this.createValuesUrl(this.encodedTeamRecordRange(), {
      majorDimension: "ROWS",
    });
    const payload = await this.requestJson(url);
    const values = parseValuesResponse(payload);

    return values
      .filter((rowValues, index) => !isTeamBattleHeaderRow(rowValues, index))
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

  private async requestJson(
    url: string,
    init: {
      method?: string;
      body?: string;
    } = {},
  ): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      method: init.method ?? "GET",
      headers: this.createHeaders(),
      body: init.body,
    });

    if (!response.ok) {
      throw new Error(`Google Sheets 요청 실패: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  private createValuesUrl(rangePath: string, query: Record<string, string>): string {
    const params = new URLSearchParams(query);

    if (this.apiKey) {
      params.set("key", this.apiKey);
    }

    return `${this.baseUrl}/spreadsheets/${encodeURIComponent(
      this.spreadsheetId,
    )}/values/${rangePath}?${params.toString()}`;
  }

  private encodedRange(): string {
    return encodeURIComponent(this.range);
  }

  private encodedTeamRecordRange(): string {
    return encodeURIComponent(this.teamRecordRange);
  }
}

export function sheetTrainerRowToValues(row: SheetTrainerRow): string[] {
  parseSheetTrainerRow(row);
  return [
    String(row.version),
    row.playerId,
    row.trainerName,
    String(row.wave),
    row.createdAt,
    row.seed,
    String(row.teamPower),
    row.teamJson,
    row.runSummaryJson,
  ];
}

export function sheetTrainerRowFromValues(values: readonly unknown[]): SheetTrainerRow {
  const row = {
    version: readNumberCell(values, 0, "version") as SheetTrainerRow["version"],
    playerId: readStringCell(values, 1, "playerId"),
    trainerName: readStringCell(values, 2, "trainerName"),
    wave: readNumberCell(values, 3, "wave"),
    createdAt: readStringCell(values, 4, "createdAt"),
    seed: readStringCell(values, 5, "seed"),
    teamPower: readNumberCell(values, 6, "teamPower"),
    teamJson: readStringCell(values, 7, "teamJson"),
    runSummaryJson: readStringCell(values, 8, "runSummaryJson"),
  };

  parseSheetTrainerRow(row);
  return row;
}

export function trySheetTrainerRowFromValues(
  values: readonly unknown[],
): SheetTrainerRow | undefined {
  try {
    return sheetTrainerRowFromValues(values);
  } catch {
    return undefined;
  }
}

export function trySheetTeamBattleRecordRowFromValues(
  values: readonly unknown[],
): SheetTeamBattleRecordRow | undefined {
  try {
    return sheetTeamBattleRecordRowFromValues(values);
  } catch {
    return undefined;
  }
}

function parseValuesResponse(payload: unknown): unknown[][] {
  if (typeof payload !== "object" || payload === null || !("values" in payload)) {
    return [];
  }

  const values = (payload as { values?: unknown }).values;

  if (values === undefined) {
    return [];
  }

  if (!Array.isArray(values) || values.some((row) => !Array.isArray(row))) {
    throw new Error("Google Sheets values response must contain row arrays.");
  }

  return values as unknown[][];
}

function isHeaderRow(values: readonly unknown[], index: number): boolean {
  return (
    index === 0 &&
    SHEET_TRAINER_ROW_COLUMNS.every((column, columnIndex) => values[columnIndex] === column)
  );
}

function isTeamBattleHeaderRow(values: readonly unknown[], index: number): boolean {
  return (
    index === 0 &&
    SHEET_TEAM_BATTLE_RECORD_COLUMNS.every(
      (column, columnIndex) => values[columnIndex] === column,
    )
  );
}

function readStringCell(values: readonly unknown[], index: number, field: string): string {
  const value = values[index];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Google Sheets row ${field} must be a non-empty string.`);
  }

  return value;
}

function readNumberCell(values: readonly unknown[], index: number, field: string): number {
  const raw = readStringCell(values, index, field);
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Google Sheets row ${field} must be numeric.`);
  }

  return value;
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value;
}

function getGlobalFetch(): FetchLike {
  const fetchImpl = globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("GoogleSheetsTrainerAdapter requires a fetch implementation.");
  }

  return fetchImpl.bind(globalThis) as FetchLike;
}
