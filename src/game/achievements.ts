import { getSpecies } from "./data/catalog";
import type { GameBalance, GameState, MetaCurrencyState } from "./types";

export interface AchievementAward {
  id: string;
  message: string;
  trainerPoints: number;
}

export interface AchievementSource {
  state: GameState;
  balance: GameBalance;
}

const WAVE_MILESTONES: Record<number, number> = {
  5: 5,
  10: 10,
  15: 15,
  20: 25,
  30: 40,
  50: 80,
};

export function emptyMetaCurrency(): MetaCurrencyState {
  return { trainerPoints: 0, claimedAchievements: [] };
}

export function ensureMetaCurrency(state: GameState): MetaCurrencyState {
  if (!state.metaCurrency) {
    state.metaCurrency = emptyMetaCurrency();
  }
  return state.metaCurrency;
}

function isClaimed(meta: MetaCurrencyState, id: string): boolean {
  return meta.claimedAchievements.includes(id);
}

function awardAchievement(
  meta: MetaCurrencyState,
  id: string,
  trainerPoints: number,
  message: string,
): AchievementAward | undefined {
  if (trainerPoints <= 0 || isClaimed(meta, id)) {
    return undefined;
  }
  meta.claimedAchievements = [...meta.claimedAchievements, id];
  meta.trainerPoints += trainerPoints;
  return { id, message, trainerPoints };
}

export function awardDexUnlock(meta: MetaCurrencyState, speciesId: number): AchievementAward | undefined {
  const id = `dex:${speciesId}`;
  if (isClaimed(meta, id)) {
    return undefined;
  }
  let rarity = 1;
  try {
    rarity = Math.max(1, getSpecies(speciesId).rarity);
  } catch {
    return undefined;
  }
  const reward = rarity * 2;
  return awardAchievement(meta, id, reward, `도감 신규 등재 +${reward} TP`);
}

export function awardCheckpointDefeat(
  meta: MetaCurrencyState,
  wave: number,
  balance: GameBalance,
): AchievementAward | undefined {
  const interval = Math.max(1, balance.checkpointInterval);
  if (wave % interval !== 0 || wave <= 0) {
    return undefined;
  }
  const id = `checkpoint:${wave}`;
  const reward = Math.max(5, Math.floor(wave / 5) * 5);
  return awardAchievement(meta, id, reward, `체크포인트 ${wave}웨이브 격파 +${reward} TP`);
}

export function awardWaveMilestone(
  meta: MetaCurrencyState,
  wave: number,
): AchievementAward | undefined {
  const reward = WAVE_MILESTONES[wave];
  if (!reward) {
    return undefined;
  }
  return awardAchievement(meta, `wave:${wave}`, reward, `웨이브 ${wave} 도달 +${reward} TP`);
}

export function awardDailySheetWins(
  meta: MetaCurrencyState,
  options: { date: string; totalWins: number; teamId?: string },
): AchievementAward | undefined {
  const previous = meta.lastSheetClaim;
  const sameTeam = previous?.teamId === options.teamId;
  const wonDelta = sameTeam && previous ? options.totalWins - previous.totalWins : options.totalWins;

  meta.lastSheetClaim = { ...options };

  if (wonDelta <= 0) {
    return undefined;
  }

  const reward = Math.max(1, Math.min(40, wonDelta));
  meta.trainerPoints += reward;
  return {
    id: `sheet-daily:${options.date}`,
    message: `시트 트레이너 승리 보상 +${reward} TP`,
    trainerPoints: reward,
  };
}

export function getWaveMilestones(): number[] {
  return Object.keys(WAVE_MILESTONES)
    .map((value) => Number(value))
    .sort((left, right) => left - right);
}
