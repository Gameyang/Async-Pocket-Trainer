import type { StorageLike } from "./clientStorage";

export const TRAINER_POINTS_STORAGE_KEY = "apt:trainer-points:v1";

export interface MetaCurrencyState {
  trainerPoints: number;
  claimedAchievements: string[];
  lastSheetClaim?: {
    date: string;
    totalWins: number;
    teamId?: string;
  };
}

const EMPTY: MetaCurrencyState = {
  trainerPoints: 0,
  claimedAchievements: [],
};

export function loadTrainerPoints(storage: StorageLike): MetaCurrencyState {
  const raw = storage.getItem(TRAINER_POINTS_STORAGE_KEY);
  if (!raw) {
    return { ...EMPTY };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalize(parsed);
  } catch {
    storage.removeItem(TRAINER_POINTS_STORAGE_KEY);
    return { ...EMPTY };
  }
}

export function saveTrainerPoints(storage: StorageLike, value: MetaCurrencyState): void {
  storage.setItem(TRAINER_POINTS_STORAGE_KEY, JSON.stringify(normalize(value)));
}

export function clearTrainerPoints(storage: StorageLike): void {
  storage.removeItem(TRAINER_POINTS_STORAGE_KEY);
}

function normalize(value: unknown): MetaCurrencyState {
  if (!value || typeof value !== "object") {
    return { ...EMPTY };
  }

  const raw = value as Record<string, unknown>;
  const trainerPoints = Math.max(0, Math.floor(Number(raw.trainerPoints ?? 0)));
  const claimedSource = Array.isArray(raw.claimedAchievements) ? raw.claimedAchievements : [];
  const claimedAchievements = Array.from(
    new Set(
      claimedSource
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
        .map((entry) => entry.trim()),
    ),
  );
  const lastSheetSource =
    raw.lastSheetClaim && typeof raw.lastSheetClaim === "object"
      ? (raw.lastSheetClaim as Record<string, unknown>)
      : undefined;

  const normalized: MetaCurrencyState = {
    trainerPoints,
    claimedAchievements,
  };

  if (lastSheetSource) {
    const date = typeof lastSheetSource.date === "string" ? lastSheetSource.date : undefined;
    const totalWins = Math.max(0, Math.floor(Number(lastSheetSource.totalWins ?? 0)));
    const teamId = typeof lastSheetSource.teamId === "string" ? lastSheetSource.teamId : undefined;
    if (date) {
      normalized.lastSheetClaim = { date, totalWins, teamId };
    }
  }

  return normalized;
}
