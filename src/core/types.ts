export type StatId = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type BoostId = Exclude<StatId, 'hp'> | 'accuracy' | 'evasion';
export type MoveCategory = 'Physical' | 'Special' | 'Status';
export type MajorStatus = 'brn' | 'par' | 'psn' | 'slp' | 'frz';
export type SideId = 0 | 1;

export type Stats = Record<StatId, number>;
export type Boosts = Record<BoostId, number>;

export interface LearnsetEntry {
  move: string;
  level: number;
}

export interface PokemonSpecies {
  id: string;
  num: number;
  name: string;
  types: string[];
  baseStats: Stats;
  learnset: LearnsetEntry[];
}

export interface MoveSecondary {
  chance: number;
  status: MajorStatus | null;
  volatileStatus: string | null;
  boosts: Partial<Record<BoostId, number>> | null;
}

export interface MoveData {
  id: string;
  num: number;
  name: string;
  type: string;
  category: MoveCategory;
  target: string;
  accuracy: true | number;
  basePower: number;
  priority: number;
  critRatio: number;
  ignoreImmunity: boolean;
  damage: number | 'level' | null;
  ohko: boolean;
  status: MajorStatus | null;
  boosts: Partial<Record<BoostId, number>> | null;
  volatileStatus: string | null;
  secondaries: MoveSecondary[];
  self: {
    volatileStatus?: string;
    boosts?: Partial<Record<BoostId, number>>;
  } | null;
  drain: [number, number] | null;
  recoil: [number, number] | null;
  heal: [number, number] | null;
  multihit: number | [number, number] | null;
  selfdestruct: string | null;
  forceSwitch: boolean;
  thawsTarget: boolean;
  flags: Record<string, number> | null;
}

export interface Gen1DexData {
  source: {
    name: string;
    url: string;
    packageVersion: string;
    generatedAt: string;
  };
  species: PokemonSpecies[];
  moves: Record<string, MoveData>;
  types: string[];
  typeChart: Record<string, Record<string, number>>;
  fallbackMoveIds: string[];
}

export interface SelectedMoves {
  attack: string;
  support: string;
}

export interface Combatant {
  side: SideId;
  species: PokemonSpecies;
  level: number;
  selectedMoves: SelectedMoves;
  stats: Stats;
  hp: number;
  maxHp: number;
  boosts: Boosts;
  status: MajorStatus | null;
  statusTurns: number;
  confusionTurns: number;
  partialTrapTurns: number;
  partialTrapBy: SideId | null;
  leechSeedBy: SideId | null;
  disabledMove: string | null;
  disabledTurns: number;
  substituteHp: number;
  chargingMove: string | null;
  recharge: boolean;
  lockedMove: string | null;
  lockedTurns: number;
  bideTurns: number;
  bideDamage: number;
  focusEnergy: boolean;
  mist: boolean;
  reflect: boolean;
  lightScreen: boolean;
  transformedTypes: string[] | null;
  lastMove: string | null;
  lastDamageTaken: number;
  lastDamageCategory: MoveCategory | null;
  flinched: boolean;
}

export interface BattleLogEntry {
  turn: number;
  text: string;
  tone: 'system' | 'hit' | 'status' | 'miss' | 'ko';
}

export interface BattleState {
  seed: string;
  rngState: number;
  turn: number;
  sides: [Combatant, Combatant];
  logs: BattleLogEntry[];
  winner: SideId | 'draw' | null;
}
