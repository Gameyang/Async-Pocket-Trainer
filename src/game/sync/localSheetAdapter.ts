import { SeededRng } from "../rng";
import {
  parseSheetTrainerRow,
  serializeTrainerSnapshot,
  type SheetTrainerRow,
  type TrainerSnapshot,
} from "./trainerSnapshot";

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

export class LocalTrainerSheetAdapter implements TrainerSyncAdapter {
  private readonly rows: SheetTrainerRow[] = [];

  constructor(initialRows: readonly SheetTrainerRow[] = []) {
    for (const row of initialRows) {
      this.appendValidatedRow(row);
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

  private appendValidatedRow(row: SheetTrainerRow): void {
    parseSheetTrainerRow(row);
    this.rows.push(cloneRow(row));
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
