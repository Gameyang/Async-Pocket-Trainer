import { getMove, getSpecies } from "./data/catalog";
import { formatTrainerPoints } from "./localization";
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

export function isAchievementClaimed(meta: MetaCurrencyState | undefined, id: string): boolean {
  return Boolean(meta?.claimedAchievements.includes(id));
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

export function awardDexUnlock(
  meta: MetaCurrencyState,
  speciesId: number,
): AchievementAward | undefined {
  const id = getDexRewardAchievementId(speciesId);
  if (isClaimed(meta, id)) {
    return undefined;
  }
  const reward = calculateDexUnlockReward(speciesId);
  if (!reward) {
    return undefined;
  }
  return awardAchievement(meta, id, reward, `도감 신규 등재 ${formatTrainerPoints(reward)}`);
}

export function awardSkillUnlock(
  meta: MetaCurrencyState,
  moveId: string,
): AchievementAward | undefined {
  const id = getSkillRewardAchievementId(moveId);
  if (isClaimed(meta, id)) {
    return undefined;
  }
  const reward = calculateSkillUnlockReward(moveId);
  if (!reward) {
    return undefined;
  }
  const move = getMove(moveId);
  return awardAchievement(
    meta,
    id,
    reward,
    `${move.name} 기술 도감 보상 ${formatTrainerPoints(reward)}`,
  );
}

export function getDexRewardAchievementId(speciesId: number): string {
  return `dex:${speciesId}`;
}

export function getSkillRewardAchievementId(moveId: string): string {
  return `skill:${moveId}`;
}

export function calculateDexUnlockReward(speciesId: number): number | undefined {
  try {
    return Math.max(1, getSpecies(speciesId).rarity) * 2;
  } catch {
    return undefined;
  }
}

export function calculateSkillUnlockReward(moveId: string): number | undefined {
  let move;
  try {
    move = getMove(moveId);
  } catch {
    return undefined;
  }

  const powerScore =
    move.category === "status" ? 2 : Math.max(1, Math.ceil(Math.max(20, move.power) / 25));
  const effectScore =
    move.statusEffect ||
    move.statChanges.length > 0 ||
    move.meta.drain > 0 ||
    move.meta.healing > 0 ||
    move.meta.flinchChance > 0 ||
    move.meta.critRate > 0
      ? 1
      : 0;

  return Math.max(1, Math.min(10, powerScore + effectScore));
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
  return awardAchievement(
    meta,
    id,
    reward,
    `체크포인트 ${wave}웨이브 격파 ${formatTrainerPoints(reward)}`,
  );
}

export function awardWaveMilestone(
  meta: MetaCurrencyState,
  wave: number,
): AchievementAward | undefined {
  const reward = WAVE_MILESTONES[wave];
  if (!reward) {
    return undefined;
  }
  return awardAchievement(
    meta,
    `wave:${wave}`,
    reward,
    `웨이브 ${wave} 도달 ${formatTrainerPoints(reward)}`,
  );
}

export function awardDailySheetWins(
  meta: MetaCurrencyState,
  options: { date: string; totalWins: number; teamId?: string },
): AchievementAward | undefined {
  const previous = meta.lastSheetClaim;
  const sameTeam = previous?.teamId === options.teamId;
  const wonDelta =
    sameTeam && previous ? options.totalWins - previous.totalWins : options.totalWins;

  meta.lastSheetClaim = { ...options };

  if (wonDelta <= 0) {
    return undefined;
  }

  const reward = Math.max(1, Math.min(40, wonDelta));
  meta.trainerPoints += reward;
  return {
    id: `sheet-daily:${options.date}`,
    message: `시트 트레이너 승리 보상 ${formatTrainerPoints(reward)}`,
    trainerPoints: reward,
  };
}

export function getWaveMilestones(): number[] {
  return Object.keys(WAVE_MILESTONES)
    .map((value) => Number(value))
    .sort((left, right) => left - right);
}
