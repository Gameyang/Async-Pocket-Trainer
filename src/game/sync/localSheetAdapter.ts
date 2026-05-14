import { SeededRng } from "../rng";
import {
  parseSheetTrainerRow,
  serializeTrainerSnapshot,
  type SheetTrainerRow,
  type TrainerSnapshot,
} from "./trainerSnapshot";
import {
  matchesTeamBattleRecordQuery,
  parseSheetTeamBattleRecordRow,
  serializeTeamBattleRecord,
  type SheetTeamBattleRecordRow,
  type TeamBattleRecord,
  type TeamBattleRecordQuery,
  type TeamRecordSyncAdapter,
} from "./teamBattleRecord";

export interface TrainerRowQuery {
  wave: number;
  now?: string;
  maxAgeMs?: number;
  excludePlayerId?: string;
}

export interface TrainerSyncAdapter {
  appendSnapshot(snapshot: TrainerSnapshot): Promise<SheetTrainerRow>;
  listRows(query: TrainerRowQuery): Promise<SheetTrainerRow[]>;
  listSnapshots(query: TrainerRowQuery): Promise<TrainerSnapshot[]>;
  pickSnapshot(query: TrainerRowQuery, rng: SeededRng): Promise<TrainerSnapshot | undefined>;
}

export class LocalTrainerSheetAdapter implements TrainerSyncAdapter, TeamRecordSyncAdapter {
  private readonly rows: SheetTrainerRow[] = [];
  private readonly teamBattleRows: SheetTeamBattleRecordRow[] = [];

  constructor(
    initialRows: readonly SheetTrainerRow[] = [],
    initialTeamBattleRows: readonly SheetTeamBattleRecordRow[] = [],
  ) {
    for (const row of initialRows) {
      this.appendValidatedRow(row);
    }

    for (const row of initialTeamBattleRows) {
      this.appendValidatedTeamBattleRow(row);
    }
  }

  async appendSnapshot(snapshot: TrainerSnapshot): Promise<SheetTrainerRow> {
    const row = serializeTrainerSnapshot(snapshot);
    this.appendValidatedRow(row);
    return cloneRow(row);
  }

  async listRows(query: TrainerRowQuery): Promise<SheetTrainerRow[]> {
    return this.rows.filter((row) => matchesTrainerRowQuery(row, query)).map(cloneRow);
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
    this.appendValidatedTeamBattleRow(row);
    return cloneTeamBattleRow(row);
  }

  async listTeamBattleRows(
    query: TeamBattleRecordQuery = {},
  ): Promise<SheetTeamBattleRecordRow[]> {
    return this.teamBattleRows
      .filter((row) => matchesTeamBattleRecordQuery(row, query))
      .map(cloneTeamBattleRow);
  }

  async listTeamBattleRecords(query: TeamBattleRecordQuery = {}): Promise<TeamBattleRecord[]> {
    const rows = await this.listTeamBattleRows(query);
    return rows.map(parseSheetTeamBattleRecordRow);
  }

  private appendValidatedRow(row: SheetTrainerRow): void {
    parseSheetTrainerRow(row);
    this.rows.push(cloneRow(row));
  }

  private appendValidatedTeamBattleRow(row: SheetTeamBattleRecordRow): void {
    parseSheetTeamBattleRecordRow(row);
    this.teamBattleRows.push(cloneTeamBattleRow(row));
  }
}

export function matchesTrainerRowQuery(row: SheetTrainerRow, query: TrainerRowQuery): boolean {
  if (row.wave !== query.wave) {
    return false;
  }

  if (query.excludePlayerId && row.playerId === query.excludePlayerId) {
    return false;
  }

  if (query.now && query.maxAgeMs !== undefined) {
    const cutoff = Date.parse(query.now) - query.maxAgeMs;

    if (Date.parse(row.createdAt) < cutoff) {
      return false;
    }
  }

  return true;
}

function cloneRow(row: SheetTrainerRow): SheetTrainerRow {
  return { ...row };
}

function cloneTeamBattleRow(row: SheetTeamBattleRecordRow): SheetTeamBattleRecordRow {
  return { ...row };
}
