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
  ShopStatKey,
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

export interface StatBoostProduct {
  stat: ShopStatKey;
  tier: StatBoostTier;
  bonus: number;
  cost: number;
}

export interface StatRerollProduct {
  cost: number;
}

export interface TeachMoveProduct {
  element: ElementType;
  cost: number;
}

export interface TypeLockProduct {
  element: ElementType;
  cost: number;
}

export type PremiumOfferEffect =
  | { kind: "heal"; scope: HealScope; healRatio: number }
  | { kind: "ball"; ball: BallType; quantity: number }
  | { kind: "rarityBoost"; bonus: number }
  | { kind: "levelBoost"; min: number; max: number }
  | { kind: "typeLock"; element: ElementType }
  | { kind: "statBoost"; stat: ShopStatKey; bonus: number }
  | { kind: "teachMove"; element: ElementType; grade: 1 | 2 | 3 };

export interface PremiumOffer {
  id: PremiumOfferId;
  tpCost: number;
  label: string;
  detail: string;
  weight: number;
  targetRequired?: boolean;
  effect: PremiumOfferEffect;
}

export const shopElementTypes: readonly ElementType[] = [
  "normal",
  "fire",
  "water",
  "grass",
  "electric",
  "poison",
  "ground",
  "flying",
  "bug",
  "fighting",
  "psychic",
  "rock",
  "ghost",
  "ice",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

export const shopStatKeys: readonly ShopStatKey[] = [
  "hp",
  "attack",
  "defense",
  "special",
  "speed",
];

export const healTiers: readonly HealTier[] = [1, 2, 3, 4, 5];
export const scoutTiers: readonly ScoutTier[] = [1, 2, 3];
export const scoutKinds: readonly ScoutKind[] = ["rarity", "power"];
export const rarityBoostTiers: readonly RarityBoostTier[] = [1, 2, 3];
export const levelBoostTiers: readonly LevelBoostTier[] = [1, 2, 3, 4];
export const statBoostTiers: readonly StatBoostTier[] = [1, 2, 3];
export const teachMoveElements = shopElementTypes;
export const typeLockElements = shopElementTypes;

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

const statBoostBonuses: Record<StatBoostTier, number> = {
  1: 3,
  2: 6,
  3: 9,
};

const statBoostCosts: Record<StatBoostTier, number> = {
  1: 8,
  2: 14,
  3: 22,
};

const teachMoveCosts: Record<ElementType, number> = {
  normal: 24,
  fire: 32,
  water: 30,
  grass: 28,
  electric: 34,
  poison: 26,
  ground: 30,
  flying: 28,
  bug: 24,
  fighting: 30,
  psychic: 34,
  rock: 30,
  ghost: 34,
  ice: 36,
  dragon: 42,
  dark: 34,
  steel: 36,
  fairy: 36,
};

const typeLockCosts: Record<ElementType, number> = {
  normal: 16,
  fire: 20,
  water: 18,
  grass: 18,
  electric: 22,
  poison: 18,
  ground: 22,
  flying: 20,
  bug: 16,
  fighting: 24,
  psychic: 28,
  rock: 22,
  ghost: 28,
  ice: 30,
  dragon: 42,
  dark: 30,
  steel: 32,
  fairy: 32,
};

const statLabels: Record<ShopStatKey, string> = {
  hp: "HP",
  attack: "공",
  defense: "방",
  special: "특",
  speed: "스",
};

const typeLabels: Record<ElementType, string> = {
  normal: "노말",
  fire: "불꽃",
  water: "물",
  grass: "풀",
  electric: "전기",
  poison: "독",
  ground: "땅",
  flying: "비행",
  bug: "벌레",
  fighting: "격투",
  psychic: "에스퍼",
  rock: "바위",
  ghost: "고스트",
  ice: "얼음",
  dragon: "드래곤",
  dark: "악",
  steel: "강철",
  fairy: "페어리",
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

export function getStatBoostProduct(
  stat: ShopStatKey,
  tier: StatBoostTier,
): StatBoostProduct {
  return {
    stat,
    tier,
    bonus: statBoostBonuses[tier],
    cost: statBoostCosts[tier],
  };
}

export function getStatRerollProduct(): StatRerollProduct {
  return { cost: 24 };
}

export function getTeachMoveProduct(element: ElementType): TeachMoveProduct {
  return {
    element,
    cost: teachMoveCosts[element],
  };
}

export function getTypeLockProduct(element: ElementType): TypeLockProduct {
  return {
    element,
    cost: typeLockCosts[element],
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

function createPremiumOffers(): PremiumOffer[] {
  const offers: PremiumOffer[] = [
    premiumOffer("premium:heal:single:3", 3, "TP 단일 회복 3단계", "포켓몬 1마리 HP 50%", 4, {
      kind: "heal",
      scope: "single",
      healRatio: 0.5,
    }),
    premiumOffer("premium:heal:team:3", 4, "TP 전체 회복 3단계", "팀 전체 HP 50%", 4, {
      kind: "heal",
      scope: "team",
      healRatio: 0.5,
    }),
    premiumOffer("premium:ball:ultraball", 5, "TP 울트라볼", "울트라볼 +1", 4, {
      kind: "ball",
      ball: "ultraBall",
      quantity: 1,
    }),
    premiumOffer("premium:ball:masterball:2", 16, "TP 마스터볼 2세트", "마스터볼 +2", 2, {
      kind: "ball",
      ball: "masterBall",
      quantity: 2,
    }),
    premiumOffer("premium:ball:masterball:3", 24, "TP 마스터볼 3세트", "마스터볼 +3", 1, {
      kind: "ball",
      ball: "masterBall",
      quantity: 3,
    }),
    premiumOffer("premium:rarity-boost:2", 4, "TP 희귀도 +25%", "일반 중간 등급과 동일", 4, {
      kind: "rarityBoost",
      bonus: 0.25,
    }),
    premiumOffer("premium:rarity-boost:4", 8, "TP 희귀도 +75%", "일반 최고 등급보다 높은 보정", 2, {
      kind: "rarityBoost",
      bonus: 0.75,
    }),
    premiumOffer("premium:rarity-boost:5", 12, "TP 희귀도 +100%", "일반 최고 등급보다 높은 보정", 1, {
      kind: "rarityBoost",
      bonus: 1,
    }),
    premiumOffer("premium:level-boost:2", 3, "TP 레벨 +1~3", "일반 중간 등급과 동일", 4, {
      kind: "levelBoost",
      min: 1,
      max: 3,
    }),
    premiumOffer("premium:level-boost:5", 8, "TP 레벨 +4~8", "일반 최고 등급보다 높은 보정", 2, {
      kind: "levelBoost",
      min: 4,
      max: 8,
    }),
    premiumOffer("premium:level-boost:6", 12, "TP 레벨 +6~10", "일반 최고 등급보다 높은 보정", 1, {
      kind: "levelBoost",
      min: 6,
      max: 10,
    }),
  ];

  for (const stat of shopStatKeys) {
    const label = statLabels[stat];
    offers.push(
      premiumOffer(
        `premium:stat-boost:${stat}:2`,
        3,
        `TP ${label} +6`,
        "일반 중간 등급과 동일",
        4,
        { kind: "statBoost", stat, bonus: 6 },
        true,
      ),
      premiumOffer(
        `premium:stat-boost:${stat}:4`,
        6,
        `TP ${label} +12`,
        "일반 최고 등급보다 높은 강화",
        2,
        { kind: "statBoost", stat, bonus: 12 },
        true,
      ),
      premiumOffer(
        `premium:stat-boost:${stat}:5`,
        8,
        `TP ${label} +15`,
        "일반 최고 등급보다 높은 강화",
        1,
        { kind: "statBoost", stat, bonus: 15 },
        true,
      ),
    );
  }

  for (const element of shopElementTypes) {
    const label = typeLabels[element];
    offers.push(
      premiumOffer(
        `premium:type-lock:${element}`,
        4,
        `TP ${label} 고정`,
        "일반 타입 고정과 동일",
        3,
        { kind: "typeLock", element },
      ),
      premiumOffer(
        `premium:teach-move:${element}:1`,
        4,
        `TP ${label} 기술`,
        "일반 기술머신과 동일",
        4,
        { kind: "teachMove", element, grade: 1 },
        true,
      ),
      premiumOffer(
        `premium:teach-move:${element}:2`,
        7,
        `TP ${label} 상급 기술`,
        "일반 기술머신보다 강한 기술",
        2,
        { kind: "teachMove", element, grade: 2 },
        true,
      ),
      premiumOffer(
        `premium:teach-move:${element}:3`,
        10,
        `TP ${label} 최상급 기술`,
        "일반 기술머신보다 강한 기술",
        1,
        { kind: "teachMove", element, grade: 3 },
        true,
      ),
    );
  }

  return offers;
}

function premiumOffer(
  id: PremiumOfferId,
  tpCost: number,
  label: string,
  detail: string,
  weight: number,
  effect: PremiumOfferEffect,
  targetRequired = false,
): PremiumOffer {
  return {
    id,
    tpCost,
    label,
    detail,
    weight,
    targetRequired,
    effect,
  };
}

const premiumOfferList = createPremiumOffers();
const premiumOfferMap = new Map(premiumOfferList.map((offer) => [offer.id, offer]));

export const premiumOfferIds: readonly PremiumOfferId[] = premiumOfferList.map((offer) => offer.id);

export function hasPremiumOffer(id: PremiumOfferId): boolean {
  return premiumOfferMap.has(id);
}

export function getPremiumOffer(id: PremiumOfferId): PremiumOffer {
  const offer = premiumOfferMap.get(id);
  if (!offer) {
    throw new Error(`Unknown premium offer: ${id}`);
  }
  return offer;
}
