import {dexData, getMove} from './dex';
import type {Boosts, Combatant, IndividualValues, MoveData, PokemonSpecies, SelectedMoves, StatId, Stats} from './types';
import type {Rng} from './rng';

const fallbackAttackByType: Record<string, string[]> = {
  Normal: ['tackle', 'scratch'],
  Fire: ['ember'],
  Water: ['watergun'],
  Electric: ['thundershock'],
  Grass: ['vinewhip'],
  Ice: ['icebeam'],
  Fighting: ['lowkick'],
  Poison: ['poisonsting'],
  Ground: ['earthquake'],
  Flying: ['gust', 'peck'],
  Psychic: ['confusion'],
  Bug: ['leechlife', 'twineedle'],
  Rock: ['rockthrow'],
  Ghost: ['nightshade'],
  Dragon: ['dragonrage'],
};

const fallbackSupportMoves = [
  'growl',
  'tailwhip',
  'leer',
  'sandattack',
  'harden',
  'withdraw',
  'doubleteam',
  'agility',
];

const boostIds = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const;
const statIds: readonly StatId[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const fixedEvTerm = 63;

function isAttackMove(move: MoveData): boolean {
  return move.basePower > 0 || move.damage !== null || move.ohko;
}

function isSupportMove(move: MoveData): boolean {
  return move.category === 'Status' && !isAttackMove(move);
}

function createBoosts(): Boosts {
  return Object.fromEntries(boostIds.map(stat => [stat, 0])) as Boosts;
}

export function createIndividualValues(rng: Rng): IndividualValues {
  return Object.fromEntries(statIds.map(stat => [stat, rng.int(0, 15)])) as IndividualValues;
}

export function calculateStats(species: PokemonSpecies, level: number, individualValues: IndividualValues): Stats {
  const hp = Math.floor((((species.baseStats.hp + individualValues.hp) * 2 + fixedEvTerm) * level) / 100) + level + 10;
  const stat = (base: number, individualValue: number) => {
    return Math.floor((((base + individualValue) * 2 + fixedEvTerm) * level) / 100) + 5;
  };

  return {
    hp,
    atk: stat(species.baseStats.atk, individualValues.atk),
    def: stat(species.baseStats.def, individualValues.def),
    spa: stat(species.baseStats.spa, individualValues.spa),
    spd: stat(species.baseStats.spd, individualValues.spd),
    spe: stat(species.baseStats.spe, individualValues.spe),
  };
}

export function selectMovesForLevel(species: PokemonSpecies, level: number, rng: Rng): SelectedMoves {
  const unlockedMoves = species.learnset
    .filter(entry => entry.level <= level)
    .map(entry => entry.move)
    .filter(moveId => dexData.moves[moveId]);

  const attacks = unlockedMoves.filter(moveId => isAttackMove(getMove(moveId)));
  const supports = unlockedMoves.filter(moveId => isSupportMove(getMove(moveId)));

  const typeFallbacks = species.types.flatMap(type => fallbackAttackByType[type] ?? []);
  const attackPool = attacks.length > 0 ? attacks : typeFallbacks.filter(moveId => dexData.moves[moveId]);
  const supportPool = supports.length > 0 ? supports : fallbackSupportMoves.filter(moveId => dexData.moves[moveId]);

  return {
    attack: rng.pick(attackPool.length > 0 ? attackPool : ['tackle']),
    support: rng.pick(supportPool.length > 0 ? supportPool : ['growl']),
  };
}

export function createCombatant(side: 0 | 1, species: PokemonSpecies, level: number, rng: Rng): Combatant {
  const individualValues = createIndividualValues(rng);
  const stats = calculateStats(species, level, individualValues);

  return {
    side,
    species,
    level,
    selectedMoves: selectMovesForLevel(species, level, rng),
    individualValues,
    stats,
    hp: stats.hp,
    maxHp: stats.hp,
    boosts: createBoosts(),
    status: null,
    statusTurns: 0,
    confusionTurns: 0,
    partialTrapTurns: 0,
    partialTrapBy: null,
    leechSeedBy: null,
    disabledMove: null,
    disabledTurns: 0,
    substituteHp: 0,
    chargingMove: null,
    recharge: false,
    lockedMove: null,
    lockedTurns: 0,
    lockedKind: null,
    lockedAccuracy: null,
    partialTrapDamage: null,
    bideTurns: 0,
    bideDamage: 0,
    focusEnergy: false,
    mist: false,
    reflect: false,
    lightScreen: false,
    transformedTypes: null,
    lastMove: null,
    lastSelectedMove: null,
    lastDamageTaken: 0,
    lastDamageMoveType: null,
    lastDamageCategory: null,
    flinched: false,
    invulnerable: false,
  };
}

export function chooseRandomSpeciesPair(rng: Rng): [PokemonSpecies, PokemonSpecies] {
  const first = rng.pick(dexData.species);
  let second = rng.pick(dexData.species);

  while (second.id === first.id) {
    second = rng.pick(dexData.species);
  }

  return [first, second];
}
