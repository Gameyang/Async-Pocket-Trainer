import type { TrainerSnapshot } from "./trainerSnapshot";
import { serializeTrainerSnapshot } from "./trainerSnapshot";
import { SHEET_TRAINER_ROW_COLUMNS, sheetTrainerRowToValues } from "./googleSheetsAdapter";
import {
  DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME,
  serializeTeamBattleRecord,
  SHEET_TEAM_BATTLE_RECORD_COLUMNS,
  sheetTeamBattleRecordRowToValues,
  type TeamBattleRecord,
} from "./teamBattleRecord";

export interface AppsScriptSubmitterOptions {
  submitUrl: string;
  teamRecordSheetName?: string;
  fetch?: AppsScriptFetchLike;
}

export interface AppsScriptSubmitResult {
  ok: true;
  opaque: true;
}

export type AppsScriptFetchLike = (
  input: string,
  init?: {
    method?: string;
    mode?: RequestMode;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<unknown>;

export class AppsScriptSubmitter {
  private readonly submitUrl: string;
  private readonly teamRecordSheetName: string;
  private readonly fetchImpl: AppsScriptFetchLike;

  constructor(options: AppsScriptSubmitterOptions) {
    this.submitUrl = requireNonEmpty(options.submitUrl, "submitUrl");
    this.teamRecordSheetName = requireNonEmpty(
      options.teamRecordSheetName ?? DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME,
      "teamRecordSheetName",
    );
    this.fetchImpl = options.fetch ?? getGlobalFetch();
  }

  async submitSnapshot(snapshot: TrainerSnapshot): Promise<AppsScriptSubmitResult> {
    const row = serializeTrainerSnapshot(snapshot);

    await this.fetchImpl(this.submitUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        ...row,
        columns: [...SHEET_TRAINER_ROW_COLUMNS],
        values: sheetTrainerRowToValues(row),
        row,
        snapshot,
      }),
    });

    return {
      ok: true,
      opaque: true,
    };
  }

  async submitTeamBattleRecord(record: TeamBattleRecord): Promise<AppsScriptSubmitResult> {
    const row = serializeTeamBattleRecord(record);

    await this.fetchImpl(this.submitUrl, {
      method: "POST",
      mode: "no-cors",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        kind: "teamBattleRecord",
        sheetName: this.teamRecordSheetName,
        ...row,
        columns: [...SHEET_TEAM_BATTLE_RECORD_COLUMNS],
        values: sheetTeamBattleRecordRowToValues(row),
        row,
        record,
      }),
    });

    return {
      ok: true,
      opaque: true,
    };
  }
}

function requireNonEmpty(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value.trim();
}

function getGlobalFetch(): AppsScriptFetchLike {
  const fetchImpl = globalThis.fetch;

  if (!fetchImpl) {
    throw new Error("AppsScriptSubmitter requires a fetch implementation.");
  }

  return fetchImpl.bind(globalThis) as AppsScriptFetchLike;
}
