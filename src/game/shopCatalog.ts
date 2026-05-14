import type {
  BallType,
  ElementType,
  GameBalance,
  HealScope,
  HealTier,
  LevelBoostTier,
  PremiumOfferId,
  RarityBoostTier,
  ScoutKind,
  ScoutTier,
  StatBoostTier,
} from "./types";

export interface RarityBoostProduct {
  tier: RarityBoostTier;
  bonus: number;
  cost: number;
}

export interface LevelBoostProduct {
  tier: LevelBoostTier;
  min: number;
  max: number;
  cost: number;
}

export interface HealProduct {
  scope: HealScope;
  tier: HealTier;
  healRatio: number;
  cost: number;
}

export interface ScoutProduct {
  kind: ScoutKind;
  tier: ScoutTier;
  cost: number;
}

const healRatios: Record<HealTier, number> = {
  1: 0.2,
  2: 0.35,
  3: 0.5,
  4: 0.75,
  5: 1,
};

const singleHealCosts: Record<HealTier, number> = {
  1: 4,
  2: 7,
  3: 10,
  4: 14,
  5: 20,
};

const teamHealCosts: Record<HealTier, number> = {
  1: 6,
  2: 10,
  3: 14,
  4: 18,
  5: 20,
};

const scoutCosts: Record<ScoutKind, Record<ScoutTier, number>> = {
  rarity: {
    1: 8,
    2: 15,
    3: 28,
  },
  power: {
    1: 6,
    2: 12,
    3: 22,
  },
};

export const healTiers: readonly HealTier[] = [1, 2, 3, 4, 5];
export const scoutTiers: readonly ScoutTier[] = [1, 2, 3];
export const scoutKinds: readonly ScoutKind[] = ["rarity", "power"];
export const rarityBoostTiers: readonly RarityBoostTier[] = [1, 2, 3];
export const levelBoostTiers: readonly LevelBoostTier[] = [1, 2, 3, 4];

const rarityBoostBonuses: Record<RarityBoostTier, number> = {
  1: 0.1,
  2: 0.25,
  3: 0.5,
};

const rarityBoostCosts: Record<RarityBoostTier, number> = {
  1: 12,
  2: 22,
  3: 40,
};

const levelBoostRanges: Record<LevelBoostTier, { min: number; max: number }> = {
  1: { min: 1, max: 2 },
  2: { min: 1, max: 3 },
  3: { min: 2, max: 4 },
  4: { min: 3, max: 6 },
};

const levelBoostCosts: Record<LevelBoostTier, number> = {
  1: 6,
  2: 11,
  3: 18,
  4: 30,
};

export function getRarityBoostProduct(tier: RarityBoostTier): RarityBoostProduct {
  return {
    tier,
    bonus: rarityBoostBonuses[tier],
    cost: rarityBoostCosts[tier],
  };
}

export function getLevelBoostProduct(tier: LevelBoostTier): LevelBoostProduct {
  return {
    tier,
    min: levelBoostRanges[tier].min,
    max: levelBoostRanges[tier].max,
    cost: levelBoostCosts[tier],
  };
}

export interface StatBoostProduct {
  tier: StatBoostTier;
  bonus: number;
  cost: number;
}

const statBoostBonuses: Record<StatBoostTier, number> = {
  1: 5,
  2: 10,
  3: 20,
};

const statBoostCosts: Record<StatBoostTier, number> = {
  1: 18,
  2: 35,
  3: 65,
};

export const statBoostTiers: readonly StatBoostTier[] = [1, 2, 3];

export function getStatBoostProduct(tier: StatBoostTier): StatBoostProduct {
  return {
    tier,
    bonus: statBoostBonuses[tier],
    cost: statBoostCosts[tier],
  };
}

export interface StatRerollProduct {
  cost: number;
}

export function getStatRerollProduct(): StatRerollProduct {
  return { cost: 24 };
}

export interface TeachMoveProduct {
  element: ElementType;
  cost: number;
}

export const teachMoveElements: readonly ElementType[] = ["fire", "water", "electric", "grass"];

const teachMoveCosts: Partial<Record<ElementType, number>> = {
  fire: 32,
  water: 30,
  electric: 34,
  grass: 28,
};

export function getTeachMoveProduct(element: ElementType): TeachMoveProduct {
  return {
    element,
    cost: teachMoveCosts[element] ?? 32,
  };
}

export interface TypeLockProduct {
  element: ElementType;
  cost: number;
}

export const typeLockElements: readonly ElementType[] = ["fire", "water", "dragon", "psychic"];

const typeLockCosts: Partial<Record<ElementType, number>> = {
  fire: 20,
  water: 18,
  dragon: 42,
  psychic: 28,
};

export function getTypeLockProduct(element: ElementType): TypeLockProduct {
  return {
    element,
    cost: typeLockCosts[element] ?? 22,
  };
}

export function getHealProduct(scope: HealScope, tier: HealTier): HealProduct {
  return {
    scope,
    tier,
    healRatio: healRatios[tier],
    cost: scope === "single" ? singleHealCosts[tier] : teamHealCosts[tier],
  };
}

export function getScoutProduct(kind: ScoutKind, tier: ScoutTier): ScoutProduct {
  return {
    kind,
    tier,
    cost: scoutCosts[kind][tier],
  };
}

export function getBallCost(ball: BallType, balance: GameBalance): number {
  switch (ball) {
    case "pokeBall":
      return balance.pokeBallCost;
    case "greatBall":
      return balance.greatBallCost;
    case "ultraBall":
      return balance.ultraBallCost;
    case "hyperBall":
      return balance.hyperBallCost;
    case "masterBall":
      return balance.masterBallCost;
  }
}

export function ballActionSlug(ball: BallType): string {
  switch (ball) {
    case "pokeBall":
      return "pokeball";
    case "greatBall":
      return "greatball";
    case "ultraBall":
      return "ultraball";
    case "hyperBall":
      return "hyperball";
    case "masterBall":
      return "masterball";
  }
}

export interface PremiumOffer {
  id: PremiumOfferId;
  tpCost: number;
  label: string;
  detail: string;
}

const premiumOffers: Record<PremiumOfferId, PremiumOffer> = {
  "premium:masterball": {
    id: "premium:masterball",
    tpCost: 15,
    label: "전설의 마스터볼",
    detail: "마스터볼 +1",
  },
  "premium:revive": {
    id: "premium:revive",
    tpCost: 12,
    label: "기적의 부활",
    detail: "팀 전원 부활 + HP 100%",
  },
  "premium:coin-bag": {
    id: "premium:coin-bag",
    tpCost: 6,
    label: "행운의 코인 주머니",
    detail: "인게임 코인 +50",
  },
  "premium:team-reroll": {
    id: "premium:team-reroll",
    tpCost: 20,
    label: "운명의 재추첨",
    detail: "선택 포켓몬을 동등 희귀도 다른 종으로 교체",
  },
  "premium:dex-unlock": {
    id: "premium:dex-unlock",
    tpCost: 25,
    label: "신화의 발견",
    detail: "미언락 종 1개를 도감에 영구 추가",
  },
};

export const premiumOfferIds: readonly PremiumOfferId[] = [
  "premium:masterball",
  "premium:revive",
  "premium:coin-bag",
  "premium:team-reroll",
  "premium:dex-unlock",
];

export function getPremiumOffer(id: PremiumOfferId): PremiumOffer {
  return premiumOffers[id];
}

