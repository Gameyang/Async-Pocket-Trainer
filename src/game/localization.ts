import type {
  BallType,
  BattleStatus,
  ElementType,
  EncounterKind,
  GamePhase,
  VolatileBattleStatus,
} from "./types";

export type KoreanJosaPair = "이/가" | "을/를" | "은/는" | "와/과" | "으로/로";

export const GAME_TITLE = "비동기 포켓 트레이너";
export const DEFAULT_BROWSER_TRAINER_NAME = "브라우저 트레이너";
export const DEFAULT_HEADLESS_TRAINER_NAME = "자동 트레이너";

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

const statusLabels: Record<string, string> = {
  burn: "화상",
  poison: "독",
  paralysis: "마비",
  sleep: "잠듦",
  freeze: "얼음",
};

const volatileStatusLabels: Record<VolatileBattleStatus, string> = {
  confusion: "confusion",
  trap: "trap",
  "leech-seed": "leech seed",
  disable: "disable",
  yawn: "yawn",
  "stealth-rock": "stealth rock",
};
Object.assign(statusLabels, volatileStatusLabels);

export function formatWave(wave: number): string {
  return `${wave}웨이브`;
}

export function formatMoney(money: number): string {
  return `🪙 ${money}`;
}

export function formatTrainerPoints(points: number): string {
  return `💎 ${points}`;
}

export function localizeBall(ball: BallType): string {
  switch (ball) {
    case "pokeBall":
      return "몬스터볼";
    case "greatBall":
      return "슈퍼볼";
    case "ultraBall":
      return "하이퍼볼";
    case "hyperBall":
      return "레전드볼";
    case "masterBall":
      return "마스터볼";
  }
}

export function localizeBallShort(ball: BallType): string {
  switch (ball) {
    case "pokeBall":
      return "몬볼";
    case "greatBall":
      return "슈퍼";
    case "ultraBall":
      return "하이퍼";
    case "hyperBall":
      return "레전드";
    case "masterBall":
      return "마스터";
  }
}

export function withJosa(value: string, pair: KoreanJosaPair): string {
  const trimmed = value.trimEnd();
  const suffix = selectJosa(trimmed, pair);

  return `${trimmed}${suffix}`;
}

export function selectJosa(value: string, pair: KoreanJosaPair): string {
  const code = getLastKoreanSyllableCode(value);
  const jongseong = code === undefined ? getDigitJongseong(value) : (code - 0xac00) % 28;
  const hasFinal = jongseong !== undefined && jongseong > 0;

  switch (pair) {
    case "이/가":
      return hasFinal ? "이" : "가";
    case "을/를":
      return hasFinal ? "을" : "를";
    case "은/는":
      return hasFinal ? "은" : "는";
    case "와/과":
      return hasFinal ? "과" : "와";
    case "으로/로":
      return hasFinal && jongseong !== 8 ? "으로" : "로";
  }
}

export function localizeBattleStatus(
  status: BattleStatus | VolatileBattleStatus | undefined,
): string {
  return status ? statusLabels[status] : "상태 이상";
}

export function localizeEncounterKind(kind: EncounterKind): string {
  return kind === "trainer" ? "트레이너" : "야생";
}

export function localizePhase(phase: GamePhase): string {
  switch (phase) {
    case "starterChoice":
      return "스타터 선택";
    case "ready":
      return "준비";
    case "captureDecision":
      return "포획";
    case "teamDecision":
      return "팀 편성";
    case "gameOver":
      return "게임 오버";
  }
}

export function localizeType(type: ElementType): string {
  return typeLabels[type];
}

export function localizeTypes(types: readonly ElementType[]): string[] {
  return types.map(localizeType);
}

export function localizeWinner(winner: "player" | "enemy"): string {
  return winner === "player" ? "승리" : "패배";
}

function getLastKoreanSyllableCode(value: string): number | undefined {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    const code = value.charCodeAt(index);

    if (code >= 0xac00 && code <= 0xd7a3) {
      return code;
    }
  }

  return undefined;
}

function getDigitJongseong(value: string): number | undefined {
  const digit = value.match(/\d(?=\D*$)/)?.[0];

  if (!digit) {
    return undefined;
  }

  return {
    "0": 21,
    "1": 8,
    "2": 0,
    "3": 16,
    "4": 0,
    "5": 0,
    "6": 1,
    "7": 8,
    "8": 8,
    "9": 0,
  }[digit];
}
