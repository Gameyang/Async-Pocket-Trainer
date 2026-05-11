export type ElementType =
  | "normal"
  | "fire"
  | "water"
  | "grass"
  | "electric"
  | "poison"
  | "ground"
  | "flying"
  | "bug"
  | "fighting"
  | "psychic"
  | "rock"
  | "ghost"
  | "ice"
  | "dragon"
  | "dark"
  | "steel"
  | "fairy";

export type MoveCategory = "physical" | "special";
export type BallType = "pokeBall" | "greatBall";
export type EncounterKind = "wild" | "trainer";
export type GamePhase = "starterChoice" | "ready" | "captureDecision" | "teamDecision" | "gameOver";

export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  special: number;
  speed: number;
}

export interface MoveDefinition {
  id: string;
  name: string;
  type: ElementType;
  power: number;
  accuracy: number;
  category: MoveCategory;
}

export interface SpeciesDefinition {
  id: number;
  name: string;
  types: ElementType[];
  baseStats: Stats;
  movePool: string[];
  captureRate: number;
  rarity: number;
}

export interface Creature {
  instanceId: string;
  speciesId: number;
  speciesName: string;
  types: ElementType[];
  stats: Stats;
  currentHp: number;
  moves: MoveDefinition[];
  rarityScore: number;
  powerScore: number;
  captureRate: number;
}

export interface BattleLogEntry {
  turn: number;
  actorId: string;
  actor: string;
  targetId: string;
  target: string;
  move: string;
  damage: number;
  effectiveness: number;
  critical: boolean;
  missed: boolean;
  targetRemainingHp: number;
}

export interface BattleResult {
  kind: EncounterKind;
  winner: "player" | "enemy";
  turns: number;
  playerTeam: Creature[];
  enemyTeam: Creature[];
  log: BattleLogEntry[];
}

export interface EncounterSnapshot {
  kind: EncounterKind;
  wave: number;
  opponentName: string;
  enemyTeam: Creature[];
}

export interface GameEvent {
  id: number;
  wave: number;
  type: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface GameBalance {
  checkpointInterval: number;
  maxTeamSize: number;
  trainerTeamSizeCheckpointSpan: number;
  wildBaseStatBudgetBase: number;
  wildBaseStatBudgetPerWave: number;
  wildRarityBudgetWaveDivisor: number;
  wildStatGrowthPerWave: number;
  trainerStatGrowthPerWave: number;
  battleDamageScale: number;
  rewardBase: number;
  rewardPerWave: number;
  trainerRewardBonus: number;
  teamRestCost: number;
  pokeBallCost: number;
  greatBallCost: number;
  startingMoney: number;
  startingPokeBalls: number;
  startingGreatBalls: number;
}

export interface GameState {
  version: 1;
  seed: string;
  rngState: number;
  trainerName: string;
  phase: GamePhase;
  currentWave: number;
  money: number;
  balls: Record<BallType, number>;
  team: Creature[];
  pendingEncounter?: EncounterSnapshot;
  pendingCapture?: Creature;
  lastBattle?: BattleResult;
  events: GameEvent[];
  gameOverReason?: string;
}

export type GameAction =
  | { type: "START_RUN"; starterSpeciesId?: number; trainerName?: string }
  | { type: "RESOLVE_NEXT_ENCOUNTER" }
  | { type: "ATTEMPT_CAPTURE"; ball: BallType }
  | { type: "ACCEPT_CAPTURE"; replaceIndex?: number }
  | { type: "DISCARD_CAPTURE" }
  | { type: "REST_TEAM" }
  | { type: "BUY_BALL"; ball: BallType; quantity?: number };

export interface AutoPlayOptions {
  maxWaves: number;
  maxSteps?: number;
  strategy?: "greedy" | "conserveBalls";
}

export interface RunSummary {
  seed: string;
  trainerName: string;
  finalWave: number;
  phase: GamePhase;
  money: number;
  balls: Record<BallType, number>;
  teamSize: number;
  teamPower: number;
  events: number;
  gameOverReason?: string;
}
