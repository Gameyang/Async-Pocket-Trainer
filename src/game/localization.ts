import type { BallType, BattleStatus, ElementType, EncounterKind, GamePhase } from "./types";

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

const statusLabels: Record<BattleStatus, string> = {
  burn: "화상",
  poison: "독",
  paralysis: "마비",
  sleep: "잠듦",
  freeze: "얼음",
};

export function formatWave(wave: number): string {
  return `${wave}웨이브`;
}

export function formatMoney(money: number): string {
  return `${money}코인`;
}

export function localizeBall(ball: BallType): string {
  return ball === "greatBall" ? "슈퍼볼" : "몬스터볼";
}

export function localizeBallShort(ball: BallType): string {
  return ball === "greatBall" ? "슈퍼" : "몬볼";
}

export function localizeBattleStatus(status: BattleStatus | undefined): string {
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
