import { scoreTeam } from "../scoring";
import type {
  GameState,
  OpponentBattleOutcome,
  OpponentTeamRecordContext,
  TeamRecordChange,
  TeamRecordSummary,
} from "../types";
import type { TrainerSnapshot } from "./trainerSnapshot";

export const TEAM_BATTLE_RECORD_VERSION = 1;
export const DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME = "APT_TEAM_RECORDS";
export const DEFAULT_TEAM_BATTLE_RECORD_RANGE = `${DEFAULT_TEAM_BATTLE_RECORD_SHEET_NAME}!A:S`;

export const SHEET_TEAM_BATTLE_RECORD_COLUMNS = [
  "version",
  "recordId",
  "createdAt",
  "opponentTeamId",
  "opponentPlayerId",
  "opponentTrainerName",
  "opponentWave",
  "opponentCreatedAt",
  "opponentSeed",
  "opponentTeamPower",
  "challengerPlayerId",
  "challengerTrainerName",
  "challengerSeed",
  "battleWave",
  "battleWinner",
  "opponentResult",
  "challengerTeamPower",
  "turns",
  "source",
] as const;

export interface TeamBattleRecord {
  version: typeof TEAM_BATTLE_RECORD_VERSION;
  recordId: string;
  createdAt: string;
  opponentTeamId: string;
  opponentPlayerId: string;
  opponentTrainerName: string;
  opponentWave: number;
  opponentCreatedAt: string;
  opponentSeed: string;
  opponentTeamPower: number;
  challengerPlayerId: string;
  challengerTrainerName: string;
  challengerSeed: string;
  battleWave: number;
  battleWinner: "player" | "enemy";
  opponentResult: OpponentBattleOutcome;
  challengerTeamPower: number;
  turns: number;
  source: "browser";
}

export type SheetTeamBattleRecordRow = TeamBattleRecord;

export interface TeamBattleRecordQuery {
  opponentTeamId?: string;
  challengerPlayerId?: string;
  battleWave?: number;
}

export interface TeamRecordSyncAdapter {
  appendTeamBattleRecord(record: TeamBattleRecord): Promise<SheetTeamBattleRecordRow>;
  listTeamBattleRows(query?: TeamBattleRecordQuery): Promise<SheetTeamBattleRecordRow[]>;
  listTeamBattleRecords(query?: TeamBattleRecordQuery): Promise<TeamBattleRecord[]>;
}

export function createTrainerTeamId(snapshot: TrainerSnapshot): string {
  const teamKey = JSON.stringify({
    playerId: snapshot.playerId,
    trainerName: snapshot.trainerName,
    trainerPortraitId: snapshot.trainerPortraitId,
    teamName: snapshot.teamName,
    wave: snapshot.wave,
    createdAt: snapshot.createdAt,
    seed: snapshot.seed,
    team: snapshot.team.map((creature) => ({
      speciesId: creature.speciesId,
      level: creature.level,
      stats: creature.stats,
      moves: creature.moves,
      powerScore: creature.powerScore,
    })),
  });

  return `team-${hashString(teamKey)}`;
}

export function createOpponentTeamContext(
  snapshot: TrainerSnapshot,
  teamPower = snapshot.teamPower,
): OpponentTeamRecordContext {
  return {
    teamId: createTrainerTeamId(snapshot),
    snapshotPlayerId: snapshot.playerId,
    snapshotTrainerName: snapshot.trainerName,
    snapshotTrainerPortraitId: snapshot.trainerPortraitId,
    snapshotTeamName: snapshot.teamName,
    snapshotTrainerGreeting: snapshot.trainerGreeting,
    snapshotWave: snapshot.wave,
    snapshotCreatedAt: snapshot.createdAt,
    snapshotSeed: snapshot.seed,
    teamPower,
    record: snapshot.teamRecord,
  };
}

export function createTeamRecordSummary(teamId: string, wins = 0, losses = 0): TeamRecordSummary {
  const battles = wins + losses;
  const winRate = roundRate((wins + 1) / (battles + 2));
  const confidenceBonus = Math.min(24, Math.round(Math.log2(battles + 1) * 8));
  const strengthScore = Math.max(0, Math.min(124, Math.round(winRate * 100) + confidenceBonus));

  return {
    teamId,
    wins,
    losses,
    battles,
    winRate,
    strengthScore,
    strengthLabel: strengthLabel(winRate, battles),
  };
}

export function summarizeTeamBattleRecords(
  records: readonly TeamBattleRecord[],
  teamId: string,
): TeamRecordSummary {
  const unique = uniqueTeamBattleRecords(records).filter(
    (record) => record.opponentTeamId === teamId,
  );
  const wins = unique.filter((record) => record.opponentResult === "win").length;
  const losses = unique.filter((record) => record.opponentResult === "loss").length;

  return createTeamRecordSummary(teamId, wins, losses);
}

export function applyOpponentBattleOutcomeToSummary(
  summary: TeamRecordSummary,
  opponentResult: OpponentBattleOutcome,
): TeamRecordChange {
  const after = createTeamRecordSummary(
    summary.teamId,
    summary.wins + (opponentResult === "win" ? 1 : 0),
    summary.losses + (opponentResult === "loss" ? 1 : 0),
  );

  return {
    teamId: summary.teamId,
    before: summary,
    after,
    opponentResult,
    deltaWinRate: roundRate(after.winRate - summary.winRate),
  };
}

export function applyTeamBattleRecordToSummary(
  summary: TeamRecordSummary,
  record: TeamBattleRecord,
): TeamRecordChange {
  return applyOpponentBattleOutcomeToSummary(summary, record.opponentResult);
}

export function createTeamBattleRecord(
  state: GameState,
  options: {
    playerId: string;
    createdAt: string;
  },
): TeamBattleRecord | undefined {
  const battle = state.lastBattle;
  const opponentTeam = battle?.opponentTeam;

  if (!battle || battle.kind !== "trainer" || battle.encounterSource !== "sheet" || !opponentTeam) {
    return undefined;
  }

  assertIsoDate(options.createdAt, "createdAt");
  const battleEvent = [...state.events]
    .reverse()
    .find(
      (event) =>
        event.type === "battle_resolved" && event.data?.opponentName === battle.opponentName,
    );
  const battleWave = battleEvent?.wave ?? opponentTeam.snapshotWave;
  const eventKey = battleEvent?.id ?? state.rngState;
  const opponentResult: OpponentBattleOutcome = battle.winner === "player" ? "loss" : "win";
  const recordId = createTeamBattleRecordId({
    playerId: options.playerId,
    seed: state.seed,
    battleWave,
    eventKey,
    opponentTeamId: opponentTeam.teamId,
    battleWinner: battle.winner,
  });

  return {
    version: TEAM_BATTLE_RECORD_VERSION,
    recordId,
    createdAt: options.createdAt,
    opponentTeamId: opponentTeam.teamId,
    opponentPlayerId: opponentTeam.snapshotPlayerId,
    opponentTrainerName: opponentTeam.snapshotTrainerName,
    opponentWave: opponentTeam.snapshotWave,
    opponentCreatedAt: opponentTeam.snapshotCreatedAt,
    opponentSeed: opponentTeam.snapshotSeed,
    opponentTeamPower: opponentTeam.teamPower,
    challengerPlayerId: options.playerId,
    challengerTrainerName: state.trainerName,
    challengerSeed: state.seed,
    battleWave,
    battleWinner: battle.winner,
    opponentResult,
    challengerTeamPower: scoreTeam(battle.playerTeam),
    turns: battle.turns,
    source: "browser",
  };
}

export function serializeTeamBattleRecord(record: TeamBattleRecord): SheetTeamBattleRecordRow {
  assertTeamBattleRecord(record);
  return { ...record };
}

export function parseSheetTeamBattleRecordRow(row: unknown): TeamBattleRecord {
  const source = requireRecord(row, "SheetTeamBattleRecordRow");
  const record: TeamBattleRecord = {
    version: readRequiredNumber(source, "version") as typeof TEAM_BATTLE_RECORD_VERSION,
    recordId: readRequiredString(source, "recordId"),
    createdAt: readRequiredString(source, "createdAt"),
    opponentTeamId: readRequiredString(source, "opponentTeamId"),
    opponentPlayerId: readRequiredString(source, "opponentPlayerId"),
    opponentTrainerName: readRequiredString(source, "opponentTrainerName"),
    opponentWave: readPositiveInteger(source, "opponentWave"),
    opponentCreatedAt: readRequiredString(source, "opponentCreatedAt"),
    opponentSeed: readRequiredString(source, "opponentSeed"),
    opponentTeamPower: readNonNegativeNumber(source, "opponentTeamPower"),
    challengerPlayerId: readRequiredString(source, "challengerPlayerId"),
    challengerTrainerName: readRequiredString(source, "challengerTrainerName"),
    challengerSeed: readRequiredString(source, "challengerSeed"),
    battleWave: readPositiveInteger(source, "battleWave"),
    battleWinner: readBattleWinner(source.battleWinner),
    opponentResult: readOpponentResult(source.opponentResult),
    challengerTeamPower: readNonNegativeNumber(source, "challengerTeamPower"),
    turns: readNonNegativeInteger(source, "turns"),
    source: readSource(source.source),
  };

  assertTeamBattleRecord(record);
  return record;
}

export function sheetTeamBattleRecordRowToValues(row: SheetTeamBattleRecordRow): string[] {
  const record = parseSheetTeamBattleRecordRow(row);

  return [
    String(record.version),
    record.recordId,
    record.createdAt,
    record.opponentTeamId,
    record.opponentPlayerId,
    record.opponentTrainerName,
    String(record.opponentWave),
    record.opponentCreatedAt,
    record.opponentSeed,
    String(record.opponentTeamPower),
    record.challengerPlayerId,
    record.challengerTrainerName,
    record.challengerSeed,
    String(record.battleWave),
    record.battleWinner,
    record.opponentResult,
    String(record.challengerTeamPower),
    String(record.turns),
    record.source,
  ];
}

export function sheetTeamBattleRecordRowFromValues(
  values: readonly unknown[],
): SheetTeamBattleRecordRow {
  const row: SheetTeamBattleRecordRow = {
    version: readNumberCell(values, 0, "version") as typeof TEAM_BATTLE_RECORD_VERSION,
    recordId: readStringCell(values, 1, "recordId"),
    createdAt: readStringCell(values, 2, "createdAt"),
    opponentTeamId: readStringCell(values, 3, "opponentTeamId"),
    opponentPlayerId: readStringCell(values, 4, "opponentPlayerId"),
    opponentTrainerName: readStringCell(values, 5, "opponentTrainerName"),
    opponentWave: readNumberCell(values, 6, "opponentWave"),
    opponentCreatedAt: readStringCell(values, 7, "opponentCreatedAt"),
    opponentSeed: readStringCell(values, 8, "opponentSeed"),
    opponentTeamPower: readNumberCell(values, 9, "opponentTeamPower"),
    challengerPlayerId: readStringCell(values, 10, "challengerPlayerId"),
    challengerTrainerName: readStringCell(values, 11, "challengerTrainerName"),
    challengerSeed: readStringCell(values, 12, "challengerSeed"),
    battleWave: readNumberCell(values, 13, "battleWave"),
    battleWinner: readStringCell(values, 14, "battleWinner") as "player" | "enemy",
    opponentResult: readStringCell(values, 15, "opponentResult") as OpponentBattleOutcome,
    challengerTeamPower: readNumberCell(values, 16, "challengerTeamPower"),
    turns: readNumberCell(values, 17, "turns"),
    source: readStringCell(values, 18, "source") as "browser",
  };

  return parseSheetTeamBattleRecordRow(row);
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

export function matchesTeamBattleRecordQuery(
  row: SheetTeamBattleRecordRow,
  query: TeamBattleRecordQuery = {},
): boolean {
  if (query.opponentTeamId && row.opponentTeamId !== query.opponentTeamId) {
    return false;
  }

  if (query.challengerPlayerId && row.challengerPlayerId !== query.challengerPlayerId) {
    return false;
  }

  if (query.battleWave !== undefined && row.battleWave !== query.battleWave) {
    return false;
  }

  return true;
}

export function uniqueTeamBattleRecords(records: readonly TeamBattleRecord[]): TeamBattleRecord[] {
  const byId = new Map<string, TeamBattleRecord>();

  for (const record of records) {
    const existing = byId.get(record.recordId);
    if (!existing || Date.parse(existing.createdAt) > Date.parse(record.createdAt)) {
      byId.set(record.recordId, record);
    }
  }

  return [...byId.values()];
}

function createTeamBattleRecordId(input: {
  playerId: string;
  seed: string;
  battleWave: number;
  eventKey: number;
  opponentTeamId: string;
  battleWinner: "player" | "enemy";
}): string {
  return `battle-${hashString(
    [
      input.playerId,
      input.seed,
      input.battleWave,
      input.eventKey,
      input.opponentTeamId,
      input.battleWinner,
    ].join("|"),
  )}`;
}

function assertTeamBattleRecord(record: TeamBattleRecord): void {
  if (record.version !== TEAM_BATTLE_RECORD_VERSION) {
    throw new Error(`Unsupported team battle record version: ${record.version}`);
  }

  requireNonEmptyString(record.recordId, "recordId");
  requireNonEmptyString(record.opponentTeamId, "opponentTeamId");
  requireNonEmptyString(record.opponentPlayerId, "opponentPlayerId");
  requireNonEmptyString(record.opponentTrainerName, "opponentTrainerName");
  requireNonEmptyString(record.challengerPlayerId, "challengerPlayerId");
  requireNonEmptyString(record.challengerTrainerName, "challengerTrainerName");
  assertIsoDate(record.createdAt, "createdAt");
  assertIsoDate(record.opponentCreatedAt, "opponentCreatedAt");

  if (record.battleWinner !== "player" && record.battleWinner !== "enemy") {
    throw new Error(`Invalid battle winner: ${record.battleWinner}`);
  }

  if (record.opponentResult !== "win" && record.opponentResult !== "loss") {
    throw new Error(`Invalid opponent result: ${record.opponentResult}`);
  }

  if (record.source !== "browser") {
    throw new Error(`Invalid team battle record source: ${record.source}`);
  }
}

function strengthLabel(winRate: number, battles: number): string {
  if (battles === 0) {
    return "신규";
  }

  if (winRate >= 0.68) {
    return "강팀";
  }

  if (winRate >= 0.56) {
    return "우세";
  }

  if (winRate >= 0.44) {
    return "접전";
  }

  return "흔들림";
}

function roundRate(value: number): number {
  return Number(value.toFixed(4));
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function readRequiredString(source: Record<string, unknown>, field: string): string {
  return requireNonEmptyString(source[field], field);
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return value;
}

function readRequiredNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field];

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }

  return value;
}

function readPositiveInteger(source: Record<string, unknown>, field: string): number {
  const value = readRequiredNumber(source, field);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }

  return value;
}

function readNonNegativeInteger(source: Record<string, unknown>, field: string): number {
  const value = readRequiredNumber(source, field);

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer.`);
  }

  return value;
}

function readNonNegativeNumber(source: Record<string, unknown>, field: string): number {
  const value = readRequiredNumber(source, field);

  if (value < 0) {
    throw new Error(`${field} must be non-negative.`);
  }

  return value;
}

function readStringCell(values: readonly unknown[], index: number, field: string): string {
  const value = values[index];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Team battle row ${field} must be a non-empty string.`);
  }

  return value;
}

function readNumberCell(values: readonly unknown[], index: number, field: string): number {
  const raw = readStringCell(values, index, field);
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Team battle row ${field} must be numeric.`);
  }

  return value;
}

function readBattleWinner(value: unknown): "player" | "enemy" {
  if (value === "player" || value === "enemy") {
    return value;
  }

  throw new Error(`Invalid battle winner: ${String(value)}`);
}

function readOpponentResult(value: unknown): OpponentBattleOutcome {
  if (value === "win" || value === "loss") {
    return value;
  }

  throw new Error(`Invalid opponent result: ${String(value)}`);
}

function readSource(value: unknown): "browser" {
  if (value === "browser") {
    return value;
  }

  throw new Error(`Invalid team battle source: ${String(value)}`);
}

function assertIsoDate(value: string, field: string): void {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-compatible date string.`);
  }
}
