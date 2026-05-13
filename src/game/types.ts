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

export type MoveCategory = "physical" | "special" | "status";
export type BattleStat = "attack" | "defense" | "special" | "speed" | "accuracy" | "evasion";
export const ballTypes = [
  "pokeBall",
  "greatBall",
  "ultraBall",
  "hyperBall",
  "masterBall",
] as const;

export type BallType = (typeof ballTypes)[number];
export type EncounterKind = "wild" | "trainer";
export type GamePhase = "starterChoice" | "ready" | "captureDecision" | "teamDecision" | "gameOver";
export type AutoPlayStrategy = "greedy" | "conserveBalls";
export type BattleStatus = "burn" | "poison" | "paralysis" | "sleep" | "freeze";
export type VolatileBattleStatus =
  | "confusion"
  | "trap"
  | "leech-seed"
  | "disable"
  | "yawn"
  | "stealth-rock";
export type RouteId = "normal" | "elite" | "supply";
export type HealScope = "single" | "team";
export type HealTier = 1 | 2 | 3 | 4 | 5;
export type ScoutKind = "rarity" | "power";
export type ScoutTier = 1 | 2 | 3;
export type RarityBoostTier = 1 | 2 | 3;
export type LevelBoostTier = 1 | 2 | 3 | 4;

export interface SelectedRoute {
  id: RouteId;
  wave: number;
}

export interface EncounterBoost {
  wave: number;
  rarityBonus?: number;
  levelMin?: number;
  levelMax?: number;
}

export interface BattleStatusState {
  type: BattleStatus;
  turnsRemaining?: number;
}

export interface MoveStatusEffect {
  status: BattleStatus;
  chance: number;
}

export interface MoveStatChange {
  stat: BattleStat;
  change: number;
}

export interface MoveMeta {
  category?: string;
  ailment?: string;
  minHits?: number;
  maxHits?: number;
  minTurns?: number;
  maxTurns?: number;
  drain: number;
  healing: number;
  critRate: number;
  ailmentChance: number;
  flinchChance: number;
  statChance: number;
}

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
  priority: number;
  target?: string;
  effectId?: number;
  flags: string[];
  statChanges: MoveStatChange[];
  meta: MoveMeta;
  statusEffect?: MoveStatusEffect;
}

export interface SpeciesDefinition {
  id: number;
  name: string;
  types: ElementType[];
  baseStats: Stats;
  movePool: string[];
  levelUpMoves: SpeciesLevelUpMove[];
  weightHg: number;
  captureRate: number;
  rarity: number;
}

export interface SpeciesLevelUpMove {
  moveId: string;
  level: number;
  order: number | null;
}

export type BattleStatStages = Partial<Record<BattleStat, number>>;

export interface CreatureVolatileState {
  confusionTurns?: number;
  trapTurns?: number;
  trapSourceId?: string;
  leechSeedSourceId?: string;
  flinched?: boolean;
  protected?: boolean;
  substituteHp?: number;
  chargingMoveId?: string;
  rechargeTurns?: number;
  lockedMoveId?: string;
  lockedTurns?: number;
  tauntTurns?: number;
  encoreMoveId?: string;
  encoreTurns?: number;
  disabledMoveId?: string;
  disabledTurns?: number;
  yawnTurns?: number;
  focusEnergy?: boolean;
  bideTurns?: number;
  bideDamage?: number;
  lastMoveId?: string;
  lastDamageTaken?: number;
  lastDamageCategory?: "physical" | "special";
}

export interface Creature {
  instanceId: string;
  speciesId: number;
  speciesName: string;
  types: ElementType[];
  weightHg?: number;
  level?: number;
  stats: Stats;
  currentHp: number;
  moves: MoveDefinition[];
  rarityScore: number;
  powerScore: number;
  captureRate: number;
  status?: BattleStatusState;
  statStages?: BattleStatStages;
  volatile?: CreatureVolatileState;
}

export interface BattleLogEntry {
  turn: number;
  actorId: string;
  actor: string;
  actorSide: "player" | "enemy";
  targetId: string;
  target: string;
  targetSide: "player" | "enemy";
  move: string;
  damage: number;
  effectiveness: number;
  critical: boolean;
  missed: boolean;
  targetRemainingHp: number;
}

export type BattleReplayEvent =
  | {
      sequence: number;
      turn: number;
      type: "battle.start";
      kind: EncounterKind;
      playerTeamIds: string[];
      enemyTeamIds: string[];
    }
  | {
      sequence: number;
      turn: number;
      type: "turn.start";
      activePlayerId?: string;
      activeEnemyId?: string;
    }
  | {
      sequence: number;
      turn: number;
      type: "move.select";
      actorId: string;
      actorSide: "player" | "enemy";
      targetId: string;
      targetSide: "player" | "enemy";
      move: string;
    }
  | {
      sequence: number;
      turn: number;
      type: "move.miss";
      actorId: string;
      targetId: string;
      move: string;
    }
  | {
      sequence: number;
      turn: number;
      type: "move.effect";
      actorId?: string;
      actorSide?: "player" | "enemy";
      targetId?: string;
      targetSide?: "player" | "enemy";
      entityId?: string;
      side?: "player" | "enemy";
      move?: string;
      label: string;
    }
  | {
      sequence: number;
      turn: number;
      type: "turn.skip";
      entityId: string;
      side: "player" | "enemy";
      status: BattleStatus;
      reason: string;
    }
  | {
      sequence: number;
      turn: number;
      type: "damage.apply";
      actorId: string;
      targetId: string;
      move: string;
      damage: number;
      effectiveness: number;
      critical: boolean;
      targetHpBefore: number;
      targetHpAfter: number;
    }
  | {
      sequence: number;
      turn: number;
      type: "status.apply";
      actorId: string;
      targetId: string;
      move: string;
      status: BattleStatus;
      turnsRemaining?: number;
    }
  | {
      sequence: number;
      turn: number;
      type: "status.immune";
      actorId: string;
      targetId: string;
      move: string;
      status: BattleStatus;
    }
  | {
      sequence: number;
      turn: number;
      type: "status.tick";
      entityId: string;
      side: "player" | "enemy";
      status: BattleStatus | VolatileBattleStatus;
      damage: number;
      hpBefore: number;
      hpAfter: number;
    }
  | {
      sequence: number;
      turn: number;
      type: "status.clear";
      entityId: string;
      side: "player" | "enemy";
      status: BattleStatus;
    }
  | {
      sequence: number;
      turn: number;
      type: "creature.faint";
      entityId: string;
      side: "player" | "enemy";
    }
  | {
      sequence: number;
      turn: number;
      type: "battle.end";
      winner: "player" | "enemy";
      playerRemainingHp: number;
      enemyRemainingHp: number;
    };

export interface BattleResult {
  kind: EncounterKind;
  encounterSource?: EncounterSource;
  encounterRoute?: RouteId;
  opponentName?: string;
  winner: "player" | "enemy";
  turns: number;
  playerTeam: Creature[];
  enemyTeam: Creature[];
  log: BattleLogEntry[];
  replay: BattleReplayEvent[];
}

export interface EncounterSnapshot {
  kind: EncounterKind;
  source?: EncounterSource;
  routeId?: RouteId;
  wave: number;
  opponentName: string;
  enemyTeam: Creature[];
}

export type EncounterSource = "generated" | "sheet";

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
  restCostPerWave: number;
  supplyRouteCost: number;
  eliteRewardBonus: number;
  eliteStatMultiplier: number;
  eliteCaptureChanceBonus: number;
  defeatedCaptureHpRatioFloor: number;
  checkpointTeamSizeGrowthPerCheckpoint: number;
  teamRestCost: number;
  pokeBallCost: number;
  greatBallCost: number;
  ultraBallCost: number;
  hyperBallCost: number;
  masterBallCost: number;
  startingMoney: number;
  startingPokeBalls: number;
  startingGreatBalls: number;
  startingUltraBalls: number;
  startingHyperBalls: number;
  startingMasterBalls: number;
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
  selectedRoute?: SelectedRoute;
  encounterBoost?: EncounterBoost;
  supplyUsedAtWave?: number;
  pendingEncounter?: EncounterSnapshot;
  pendingCapture?: Creature;
  lastBattle?: BattleResult;
  events: GameEvent[];
  gameOverReason?: string;
}

export type GameAction =
  | { type: "START_RUN"; starterSpeciesId?: number; trainerName?: string }
  | { type: "RETURN_TO_STARTER_CHOICE"; trainerName?: string }
  | { type: "SET_TRAINER_NAME"; trainerName: string }
  | { type: "CHOOSE_ROUTE"; routeId: RouteId }
  | { type: "RESOLVE_NEXT_ENCOUNTER" }
  | { type: "ATTEMPT_CAPTURE"; ball: BallType }
  | { type: "ACCEPT_CAPTURE"; replaceIndex?: number }
  | { type: "DISCARD_CAPTURE" }
  | { type: "REST_TEAM" }
  | { type: "BUY_HEAL"; scope: HealScope; tier: HealTier; targetEntityId?: string }
  | { type: "BUY_BALL"; ball: BallType; quantity?: number }
  | { type: "BUY_SCOUT"; kind: ScoutKind; tier: ScoutTier }
  | { type: "BUY_RARITY_BOOST"; tier: RarityBoostTier }
  | { type: "BUY_LEVEL_BOOST"; tier: LevelBoostTier };

export interface AutoPlayOptions {
  maxWaves: number;
  maxSteps?: number;
  strategy?: AutoPlayStrategy;
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
