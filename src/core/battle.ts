import {dexData, getMove, getTypeMultiplier} from './dex';
import {createRng, createSeed, type Rng} from './rng';
import {chooseRandomSpeciesPair, createCombatant} from './teamBuilder';
import type {BattleEvent, BattleLogEntry, BattleState, BoostId, Combatant, MajorStatus, MoveData, MoveSecondary, SideId, StatId} from './types';

const maxTurns = 200;
const chargeMoves = new Set(['dig', 'skullbash', 'skyattack', 'solarbeam', 'razorwind']);
const rampageMoves = new Set(['thrash', 'petaldance']);
const inertMoves = new Set(['splash', 'teleport', 'roar', 'whirlwind']);
const partialTrapMoves = new Set(['bind', 'wrap', 'clamp', 'firespin']);
const crashOnMissMoves = new Set(['jumpkick', 'highjumpkick']);
const selfTargetVolatiles = new Set(['focusenergy', 'substitute', 'mist', 'lightscreen', 'reflect']);
const accuracyBoostTable = [25, 28, 33, 40, 50, 66, 100, 150, 200, 250, 300, 350, 400];
const boostIds: BoostId[] = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'];

const statusLabels: Record<MajorStatus, string> = {
  brn: '화상',
  par: '마비',
  psn: '독',
  slp: '수면',
  frz: '얼음',
};

const boostLabels: Record<BoostId, string> = {
  atk: '공격',
  def: '방어',
  spa: '특수',
  spd: '특수방어',
  spe: '스피드',
  accuracy: '명중',
  evasion: '회피',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function log(state: BattleState, text: string, tone: BattleLogEntry['tone'] = 'system'): void {
  state.logs.unshift({turn: state.turn, text, tone});
  state.logs = state.logs.slice(0, 120);
  state.events.push({kind: 'message', turn: state.turn, text, tone});
}

function event(state: BattleState, battleEvent: BattleEvent): void {
  state.events.push(battleEvent);
}

function opponentSide(side: SideId): SideId {
  return side === 0 ? 1 : 0;
}

function opponentOf(state: BattleState, combatant: Combatant): Combatant {
  return state.sides[opponentSide(combatant.side)];
}

function activeTypes(combatant: Combatant): string[] {
  return combatant.transformedTypes ?? combatant.species.types;
}

function statStageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function accuracyStagePercent(stage: number): number {
  return accuracyBoostTable[clamp(stage, -6, 6) + 6];
}

function modifiedStat(combatant: Combatant, stat: Exclude<StatId, 'hp'>, ignoreBoosts: boolean): number {
  let value = combatant.stats[stat];
  if (!ignoreBoosts) value = Math.floor(value * statStageMultiplier(combatant.boosts[stat]));
  if (stat === 'atk' && combatant.status === 'brn' && !ignoreBoosts) value = Math.max(1, Math.floor(value / 2));
  if (stat === 'spe' && combatant.status === 'par') value = Math.max(1, Math.floor(value / 4));
  return Math.max(1, value);
}

function effectiveSpeed(combatant: Combatant): number {
  return modifiedStat(combatant, 'spe', false);
}

function isCounterableMove(move: MoveData | null): boolean {
  return Boolean(move && move.basePower > 0 && move.id !== 'counter' && ['Normal', 'Fighting'].includes(move.type));
}

export function interruptLockedAction(combatant: Combatant, preserveInvulnerability = false): void {
  combatant.bideTurns = 0;
  combatant.bideDamage = 0;
  combatant.chargingMove = null;
  if (!preserveInvulnerability) combatant.invulnerable = false;
  if (combatant.lockedKind !== 'rage') {
    combatant.lockedMove = null;
    combatant.lockedTurns = 0;
    combatant.lockedKind = null;
    combatant.lockedAccuracy = null;
    combatant.partialTrapDamage = null;
  }
}

function recoveryGlitchFails(combatant: Combatant): boolean {
  return combatant.hp === combatant.maxHp ||
    ((combatant.hp === combatant.maxHp - 255 || combatant.hp === combatant.maxHp - 511) && combatant.hp % 256 !== 0);
}

function heal(state: BattleState, combatant: Combatant, amount: number): number {
  if (combatant.hp <= 0) return 0;
  const healed = Math.min(combatant.maxHp - combatant.hp, Math.max(0, Math.floor(amount)));
  combatant.hp += healed;
  if (healed > 0) {
    event(state, {
      kind: 'heal',
      turn: state.turn,
      side: combatant.side,
      amount: healed,
      hp: combatant.hp,
      maxHp: combatant.maxHp,
    });
  }
  return healed;
}

function applyDamage(
  state: BattleState,
  target: Combatant,
  amount: number,
  source: Combatant | null,
  move: MoveData | null,
  direct: boolean
): number {
  const damage = Math.max(1, Math.floor(amount));

  if (direct && target.substituteHp > 0 && source?.side !== target.side) {
    const uncappedDamage = damage;
    const subDamage = Math.min(target.substituteHp, damage);
    target.substituteHp -= subDamage;
    event(state, {
      kind: 'damage',
      turn: state.turn,
      side: target.side,
      sourceSide: source?.side ?? null,
      amount: subDamage,
      hp: target.hp,
      maxHp: target.maxHp,
      moveId: move?.id ?? null,
      direct,
    });
    if (move && source?.side !== target.side) {
      target.lastDamageTaken = uncappedDamage;
      target.lastDamageMoveType = move.type;
      target.lastDamageCategory = move.category;
      state.lastDamage = uncappedDamage;
      state.lastDamageMoveType = move.type;
      state.lastDamageMoveId = move.id;
    }
    log(state, `${target.species.name}의 대타가 ${subDamage} 피해를 받았다.`, 'hit');
    if (target.substituteHp <= 0) log(state, `${target.species.name}의 대타가 사라졌다.`, 'status');
    return 0;
  }

  const actual = Math.min(target.hp, damage);
  target.hp -= actual;
  event(state, {
    kind: 'damage',
    turn: state.turn,
    side: target.side,
    sourceSide: source?.side ?? null,
    amount: actual,
    hp: target.hp,
    maxHp: target.maxHp,
    moveId: move?.id ?? null,
    direct,
  });

  if (move && source?.side !== target.side) {
    target.lastDamageTaken = actual;
    target.lastDamageMoveType = move.type;
    target.lastDamageCategory = move.category;
    state.lastDamage = actual;
    state.lastDamageMoveType = move.type;
    state.lastDamageMoveId = move.id;
    if (target.bideTurns > 0) target.bideDamage += actual;
    if (target.lockedKind === 'rage' && move.category !== 'Status' && !move.selfdestruct && target.hp > 0) {
      applyBoosts(state, target, {atk: 1}, target);
    }
  }

  if (target.hp <= 0) {
    target.hp = 0;
    event(state, {kind: 'faint', turn: state.turn, side: target.side});
    log(state, `${target.species.name}이(가) 쓰러졌다.`, 'ko');
  }

  return actual;
}

function clearBoosts(combatant: Combatant): void {
  for (const boost of boostIds) combatant.boosts[boost] = 0;
}

function applyBoosts(
  state: BattleState,
  target: Combatant,
  boosts: Partial<Record<BoostId, number>>,
  source: Combatant
): void {
  for (const [rawStat, rawChange] of Object.entries(boosts) as [BoostId, number][]) {
    if (!rawChange) continue;
    if (rawChange < 0 && target.substituteHp > 0 && source.side !== target.side) {
      log(state, `${target.species.name}'s substitute blocked the stat drop.`, 'miss');
      continue;
    }
    if (rawChange < 0 && target.mist && source.side !== target.side) {
      log(state, `${target.species.name}은(는) 흰안개로 능력 감소를 막았다.`, 'status');
      continue;
    }

    const before = target.boosts[rawStat];
    const after = clamp(before + rawChange, -6, 6);
    target.boosts[rawStat] = after;
    if (after === before) {
      log(state, `${target.species.name}의 ${boostLabels[rawStat]}은(는) 더 변하지 않는다.`, 'status');
      continue;
    }

    const direction = rawChange > 0 ? '올랐다' : '떨어졌다';
    event(state, {
      kind: 'boost',
      turn: state.turn,
      side: target.side,
      stat: rawStat,
      change: rawChange,
      stage: after,
    });
    log(state, `${target.species.name}의 ${boostLabels[rawStat]}이(가) ${direction}.`, 'status');
  }
}

function canReceiveStatus(target: Combatant, source: Combatant, status: MajorStatus, _move: MoveData): boolean {
  const types = activeTypes(target);
  if (target.status && !(status === 'slp' && target.recharge)) return false;
  if (target.substituteHp > 0 && source.side !== target.side && status === 'psn') return false;
  if (status === 'brn' && types.includes('Fire')) return false;
  if (status === 'frz' && types.includes('Ice')) return false;
  if (status === 'psn' && types.includes('Poison')) return false;
  return true;
}

function applyMajorStatus(
  state: BattleState,
  target: Combatant,
  status: MajorStatus,
  source: Combatant,
  move: MoveData,
  rng: Rng
): boolean {
  if (!canReceiveStatus(target, source, status, move)) {
    log(state, `${target.species.name}에게는 ${statusLabels[status]} 효과가 없었다.`, 'miss');
    return false;
  }

  target.status = status;
  if (status === 'slp' && target.recharge) target.recharge = false;
  target.statusTurns = status === 'slp' ? rng.int(1, 7) : 0;
  event(state, {kind: 'status', turn: state.turn, side: target.side, status, active: true});
  log(state, `${target.species.name}은(는) ${statusLabels[status]} 상태가 되었다.`, 'status');
  return true;
}

function applyVolatile(
  state: BattleState,
  target: Combatant,
  source: Combatant,
  volatile: string,
  rng: Rng,
  fromSecondary = false
): boolean {
  const blockedBySubstitute =
    source.side !== target.side &&
    target.substituteHp > 0 &&
    (volatile === 'leechseed' || (volatile === 'confusion' && !fromSecondary));
  if (blockedBySubstitute) {
    log(state, `${target.species.name}의 대타가 상태 변화를 막았다.`, 'miss');
    return false;
  }

  switch (volatile) {
    case 'confusion':
      if (target.confusionTurns > 0 && !fromSecondary) return false;
      target.confusionTurns = rng.int(2, 5);
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'confusion', active: true});
      log(state, `${target.species.name}은(는) 혼란에 빠졌다.`, 'status');
      return true;
    case 'flinch':
      target.recharge = false;
      target.flinched = true;
      return true;
    case 'leechseed':
      if (target.leechSeedBy !== null) return false;
      if (activeTypes(target).includes('Grass')) {
        log(state, `${target.species.name}에게 씨뿌리기는 통하지 않았다.`, 'miss');
        return false;
      }
      target.leechSeedBy = source.side;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'leechseed', active: true});
      log(state, `${target.species.name}에게 씨앗이 심어졌다.`, 'status');
      return true;
    case 'partiallytrapped':
      target.partialTrapTurns = rng.pick([2, 2, 2, 3, 3, 3, 4, 5]);
      target.partialTrapBy = source.side;
      source.lockedMove = source.lastMove;
      source.lockedTurns = target.partialTrapTurns;
      source.lockedKind = 'partialtrap';
      source.lockedAccuracy = null;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'partiallytrapped', active: true});
      log(state, `${target.species.name}은(는) 움직임이 봉쇄됐다.`, 'status');
      return true;
    case 'disable':
      if (target.disabledMove) return false;
      target.disabledMove = rng.pick([target.selectedMoves.attack, target.selectedMoves.support]);
      target.disabledTurns = rng.int(1, 8);
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'disable', active: true});
      log(state, `${target.species.name}의 ${getMove(target.disabledMove).name}이(가) 봉인됐다.`, 'status');
      return true;
    case 'focusenergy':
      if (target.focusEnergy) return false;
      target.focusEnergy = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'focusenergy', active: true});
      log(state, `${target.species.name}은(는) 급소를 노린다.`, 'status');
      return true;
    case 'substitute':
      return createSubstitute(state, target);
    case 'mist':
      if (target.mist) return false;
      target.mist = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'mist', active: true});
      log(state, `${target.species.name}이(가) 흰안개에 둘러싸였다.`, 'status');
      return true;
    case 'lightscreen':
      if (target.lightScreen) return false;
      target.lightScreen = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'lightscreen', active: true});
      log(state, `${target.species.name}이(가) 빛의장막을 펼쳤다.`, 'status');
      return true;
    case 'reflect':
      if (target.reflect) return false;
      target.reflect = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'reflect', active: true});
      log(state, `${target.species.name}이(가) 리플렉터를 펼쳤다.`, 'status');
      return true;
    default:
      return false;
  }
}

function createSubstitute(state: BattleState, user: Combatant): boolean {
  const cost = Math.floor(user.maxHp / 4);
  if (user.substituteHp > 0 || user.hp < user.maxHp / 4) {
    log(state, `${user.species.name}은(는) 대타를 만들 수 없다.`, 'miss');
    return false;
  }

  const actualCost = user.maxHp > 3 ? cost : 0;
  user.hp = Math.max(0, user.hp - actualCost);
  user.substituteHp = cost + 1;
  if (user.partialTrapBy !== null) {
    const trapper = state.sides[user.partialTrapBy];
    if (trapper.lockedKind === 'partialtrap') {
      trapper.lockedMove = null;
      trapper.lockedTurns = 0;
      trapper.lockedKind = null;
      trapper.lockedAccuracy = null;
      trapper.partialTrapDamage = null;
    }
    user.partialTrapTurns = 0;
    user.partialTrapBy = null;
  }
  event(state, {
    kind: 'damage',
    turn: state.turn,
    side: user.side,
    sourceSide: user.side,
    amount: actualCost,
    hp: user.hp,
    maxHp: user.maxHp,
    moveId: 'substitute',
    direct: false,
  });
  event(state, {kind: 'status', turn: state.turn, side: user.side, status: 'substitute', active: true});
  log(state, `${user.species.name}이(가) HP를 깎아 대타를 만들었다.`, 'status');
  if (user.hp <= 0) {
    event(state, {kind: 'faint', turn: state.turn, side: user.side});
    log(state, `${user.species.name} fainted.`, 'ko');
  }
  return true;
}

function applySecondaryEffects(
  state: BattleState,
  source: Combatant,
  target: Combatant,
  move: MoveData,
  rng: Rng
): void {
  for (const secondary of move.secondaries) {
    if (target.hp <= 0) continue;
    if (secondary.status && ['par', 'brn', 'frz'].includes(secondary.status) && activeTypes(target).includes(move.type)) continue;
    let numerator = Math.ceil(secondary.chance * 256 / 100);
    if (secondary.volatileStatus === 'confusion') numerator -= 1;
    if (rng.int(1, 256) > numerator) continue;
    applyMoveEffect(state, source, target, move, secondary, rng);
  }
}

function applySubstituteSecondaryConfusion(
  state: BattleState,
  source: Combatant,
  target: Combatant,
  move: MoveData,
  rng: Rng
): void {
  const secondary = move.secondaries.find(effect => effect.volatileStatus === 'confusion');
  if (!secondary) return;
  let numerator = Math.ceil(secondary.chance * 256 / 100) - 1;
  numerator = clamp(numerator, 1, 255);
  if (rng.int(1, 256) <= numerator) applyMoveEffect(state, source, target, move, secondary, rng);
}

function applyMoveEffect(
  state: BattleState,
  source: Combatant,
  target: Combatant,
  move: MoveData,
  effect: Pick<MoveSecondary, 'status' | 'volatileStatus' | 'boosts'>,
  rng: Rng
): void {
  if (effect.status) applyMajorStatus(state, target, effect.status, source, move, rng);
  if (effect.volatileStatus) applyVolatile(state, target, source, effect.volatileStatus, rng, true);
  if (effect.boosts) applyBoosts(state, target, effect.boosts, source);
}

function hitsMove(state: BattleState, user: Combatant, target: Combatant, move: MoveData, rng: Rng): boolean {
  if (target.invulnerable && target.side !== user.side && !['swift', 'transform'].includes(move.id)) {
    event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
    log(state, `${target.species.name} avoided the attack.`, 'miss');
    state.lastDamage = 0;
    return false;
  }

  const multiplier = getTypeMultiplier(move.type, activeTypes(target));
  if (!move.ignoreImmunity && multiplier === 0 && move.type !== '???') {
    event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
    state.lastDamage = 0;
    log(state, `${target.species.name}에게는 효과가 없다.`, 'miss');
    return false;
  }

  if (move.status === 'slp' && target.recharge) return true;
  if (move.ohko && effectiveSpeed(user) < effectiveSpeed(target)) {
    event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
    log(state, `${user.species.name}??${move.name}?(?? ?덈Т ?먮젮 ?ㅽ뙣?덈떎.`, 'miss');
    state.lastDamage = 0;
    return false;
  }

  if (move.accuracy === true || (partialTrapMoves.has(move.id) && user.lockedKind === 'partialtrap')) {
    return true;
  }

  let threshold = Math.floor(move.accuracy * 255 / 100);
  if ((user.lockedKind === 'rage' || user.lockedKind === 'rampage') && user.lockedAccuracy !== null) {
    threshold = user.lockedAccuracy;
  }
  threshold = Math.floor(threshold * (accuracyStagePercent(user.boosts.accuracy) / 100));
  threshold = Math.floor(threshold * (accuracyStagePercent(-target.boosts.evasion) / 100));
  threshold = clamp(threshold, 1, 255);
  if (move.target === 'self') threshold = Math.min(256, threshold + 1);
  if (user.lockedKind === 'rage' || user.lockedKind === 'rampage') user.lockedAccuracy = threshold;
  if (rng.int(1, 256) > threshold) {
    event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
    state.lastDamage = 0;
    log(state, `${user.species.name}의 ${move.name}이(가) 빗나갔다.`, 'miss');
    return false;
  }

  return true;
}

function isCriticalHit(user: Combatant, move: MoveData, rng: Rng): boolean {
  const baseSpeed = user.species.baseStats.spe;
  let critChance = Math.floor(baseSpeed / 2);
  if (user.focusEnergy) {
    critChance = Math.floor(critChance / 2);
  } else {
    critChance = clamp(critChance * 2, 1, 255);
  }
  if (move.critRatio === 1) {
    critChance = Math.floor(critChance / 2);
  } else if (move.critRatio > 1) {
    critChance = clamp(critChance * 4, 1, 255);
  }
  return critChance > 0 && rng.int(1, 256) <= critChance;
}

function calculateDamage(user: Combatant, target: Combatant, move: MoveData, rng: Rng): {damage: number; critical: boolean; multiplier: number} {
  if (typeof move.damage === 'number') return {damage: move.damage, critical: false, multiplier: 1};
  if (move.damage === 'level') return {damage: user.level, critical: false, multiplier: 1};
  if (move.id === 'superfang') return {damage: Math.max(1, Math.floor(target.hp / 2)), critical: false, multiplier: 1};

  const multiplier = getTypeMultiplier(move.type, activeTypes(target));
  if (multiplier === 0) return {damage: 0, critical: false, multiplier};

  const critical = isCriticalHit(user, move, rng);
  const attackStat = move.category === 'Physical' ? 'atk' : 'spa';
  const defenseStat = move.category === 'Physical' ? 'def' : 'spd';
  let attack = modifiedStat(user, attackStat, critical);
  let defense = modifiedStat(target, defenseStat, critical);

  if (!critical && move.category === 'Physical' && target.reflect) defense *= 2;
  if (!critical && move.category === 'Special' && target.lightScreen) defense *= 2;
  if (attack >= 256 || defense >= 256) {
    attack = clamp(Math.floor(attack / 4) % 256, 1, Number.MAX_SAFE_INTEGER);
    defense = Math.floor(defense / 4) % 256;
    if (defense === 0) defense = 1;
  }
  if (move.selfdestruct && move.category === 'Physical') defense = Math.max(1, Math.floor(defense / 2));
  attack = Math.max(1, attack);
  defense = Math.max(1, defense);

  const damageLevel = critical ? user.level * 2 : user.level;
  let damage = damageLevel * 2;
  damage = Math.floor(damage / 5);
  damage += 2;
  damage *= move.basePower;
  damage *= attack;
  damage = Math.floor(damage / defense);
  damage = clamp(Math.floor(damage / 50), 0, 997);
  damage += 2;

  if (move.type !== '???' && activeTypes(user).includes(move.type)) damage += Math.floor(damage / 2);
  for (const targetType of activeTypes(target)) {
    const typeMultiplier = getTypeMultiplier(move.type, [targetType]);
    if (typeMultiplier > 1) damage = Math.floor((damage * 20) / 10);
    if (typeMultiplier > 0 && typeMultiplier < 1) damage = Math.floor((damage * 5) / 10);
  }
  if (damage > 1) damage = Math.floor((damage * rng.int(217, 255)) / 255);

  return {damage, critical, multiplier};
}

function multihitCount(move: MoveData, rng: Rng): number {
  if (!move.multihit) return 1;
  if (typeof move.multihit === 'number') return move.multihit;
  const roll = rng.int(1, 8);
  if (roll <= 3) return 2;
  if (roll <= 6) return 3;
  return roll === 7 ? 4 : 5;
}

function applyAfterDamageEffects(
  state: BattleState,
  user: Combatant,
  target: Combatant,
  move: MoveData,
  totalDamage: number,
  substituteDamage: number,
  substituteSurvived: boolean,
  substituteBroke: boolean
): void {
  const effectDamage = substituteSurvived ? substituteDamage : totalDamage;
  if (move.drain && effectDamage > 0 && (totalDamage > 0 || substituteSurvived)) {
    const restored = heal(state, user, Math.floor((effectDamage * move.drain[0]) / move.drain[1]));
    if (restored > 0) log(state, `${user.species.name}이(가) ${restored} HP를 흡수했다.`, 'status');
  }

  if (move.recoil && effectDamage > 0 && (totalDamage > 0 || substituteSurvived) && user.hp > 0) {
    const recoil = Math.max(1, Math.floor((effectDamage * move.recoil[0]) / move.recoil[1]));
    applyDamage(state, user, recoil, null, null, false);
    log(state, `${user.species.name}이(가) 반동으로 ${recoil} 피해를 받았다.`, 'hit');
  }

  if (move.selfdestruct && user.hp > 0 && !substituteBroke) {
    applyDamage(state, user, user.hp, null, null, false);
    log(state, `${user.species.name}은(는) 폭발의 반동으로 쓰러졌다.`, 'ko');
  }

  if (move.self?.volatileStatus === 'mustrecharge' && target.hp > 0 && !substituteBroke) {
    user.recharge = true;
  }
}

function executeDamagingMove(
  state: BattleState,
  user: Combatant,
  target: Combatant,
  move: MoveData,
  rng: Rng
): void {
  if (move.id === 'dreameater' && target.status !== 'slp') {
    log(state, `${move.name} failed because the target is not asleep.`, 'miss');
    return;
  }

  if (move.ohko) {
    if (effectiveSpeed(user) < effectiveSpeed(target)) {
      log(state, `${user.species.name}의 ${move.name}은(는) 너무 느려 실패했다.`, 'miss');
      return;
    }
    applyDamage(state, target, target.maxHp, user, move, true);
    log(state, `${move.name}! 일격필살이 성공했다.`, 'hit');
    return;
  }

  let totalDamage = 0;
  let substituteDamage = 0;
  let substituteSurvived = false;
  let substituteBroke = false;
  let firstHitDamage: number | null = null;
  const hits = multihitCount(move, rng);

  for (let hit = 0; hit < hits && target.hp > 0; hit += 1) {
    let result = calculateDamage(user, target, move, rng);
    if (user.lockedKind === 'partialtrap' && user.partialTrapDamage !== null) {
      result = {...result, damage: user.partialTrapDamage};
    } else if (firstHitDamage !== null) {
      result = {...result, damage: firstHitDamage};
    }
    const zeroDamagePartialTrap = partialTrapMoves.has(move.id) && move.type === 'Normal' && result.multiplier === 0;
    if (result.damage <= 0 && !zeroDamagePartialTrap) {
      log(state, `${target.species.name}에게는 효과가 없다.`, 'miss');
      return;
    }

    if (firstHitDamage === null) firstHitDamage = result.damage;

    const substituteHpBefore = target.substituteHp;
    const hadSubstitute = substituteHpBefore > 0;
    const dealt = result.damage > 0 ? applyDamage(state, target, result.damage, user, move, true) : 0;
    if (partialTrapMoves.has(move.id) && user.partialTrapDamage === null) user.partialTrapDamage = result.damage;
    if (hadSubstitute) {
      substituteDamage += result.damage;
      substituteSurvived = target.substituteHp > 0;
      if (target.substituteHp === 0) substituteBroke = true;
    }
    totalDamage += dealt;
    if (substituteBroke) break;
    const effectiveness = result.multiplier > 1 ? ' 효과가 굉장했다.' : result.multiplier > 0 && result.multiplier < 1 ? ' 효과가 별로였다.' : '';
    const critical = result.critical ? ' 급소에 맞았다.' : '';
    log(state, `${user.species.name}의 ${move.name}: ${dealt} 피해.${critical}${effectiveness}`, 'hit');
  }

  if (hits > 1) log(state, `${move.name}은(는) ${hits}번 맞았다.`, 'hit');
  applyAfterDamageEffects(state, user, target, move, totalDamage, substituteDamage, substituteSurvived, substituteBroke);
  if (target.hp > 0 && substituteSurvived) {
    applySubstituteSecondaryConfusion(state, user, target, move, rng);
  } else if (target.hp > 0 && !substituteBroke) {
    applySecondaryEffects(state, user, target, move, rng);
  }
}

function executeStatusMove(
  state: BattleState,
  user: Combatant,
  target: Combatant,
  move: MoveData,
  rng: Rng
): void {
  if (inertMoves.has(move.id)) {
    log(state, `${user.species.name}의 ${move.name}은(는) 아무 일도 일으키지 않았다.`, 'miss');
    return;
  }

  if (move.id === 'recover') {
    if (recoveryGlitchFails(user)) {
      log(state, `${user.species.name}'s ${move.name} failed.`, 'miss');
      return;
    }
    const restored = heal(state, user, Math.floor(user.maxHp / 2));
    log(state, `${user.species.name}이(가) ${restored} HP를 회복했다.`, 'status');
    return;
  }

  if (move.id === 'rest') {
    if (recoveryGlitchFails(user)) {
      log(state, `${user.species.name}'s Rest failed.`, 'miss');
      return;
    }
    heal(state, user, user.maxHp);
    user.status = 'slp';
    user.statusTurns = 2;
    event(state, {kind: 'status', turn: state.turn, side: user.side, status: 'slp', active: true});
    log(state, `${user.species.name}이(가) 잠들고 HP를 모두 회복했다.`, 'status');
    return;
  }

  if (move.id === 'haze') {
    for (const side of state.sides) {
      clearBoosts(side);
      side.confusionTurns = 0;
      side.disabledMove = null;
      side.disabledTurns = 0;
      side.focusEnergy = false;
      side.mist = false;
      side.reflect = false;
      side.lightScreen = false;
      side.leechSeedBy = null;
      if (side.side !== user.side) {
        side.status = null;
        side.statusTurns = 0;
      }
    }
    log(state, '흑안개가 모든 능력 변화를 지웠다.', 'status');
    return;
  }

  if (move.id === 'transform') {
    user.transformedTypes = activeTypes(target);
    user.stats = {...user.stats, atk: target.stats.atk, def: target.stats.def, spa: target.stats.spa, spd: target.stats.spd, spe: target.stats.spe};
    user.selectedMoves = {...target.selectedMoves};
    log(state, `${user.species.name}이(가) ${target.species.name}처럼 변신했다.`, 'status');
    return;
  }

  if (move.id === 'conversion') {
    user.transformedTypes = activeTypes(target);
    log(state, `${user.species.name} copied ${target.species.name}'s type.`, 'status');
    return;
  }

  if (move.heal) {
    const restored = heal(state, user, Math.floor((user.maxHp * move.heal[0]) / move.heal[1]));
    log(state, `${user.species.name}이(가) ${restored} HP를 회복했다.`, 'status');
    return;
  }

  if (move.status) applyMajorStatus(state, target, move.status, user, move, rng);
  if (move.volatileStatus) {
    const volatileTarget = move.target === 'self' || selfTargetVolatiles.has(move.volatileStatus) ? user : target;
    applyVolatile(state, volatileTarget, user, move.volatileStatus, rng);
  }
  if (move.boosts) applyBoosts(state, move.target === 'self' ? user : target, move.boosts, user);
  if (move.self?.boosts) applyBoosts(state, user, move.self.boosts, user);
}

function executeSpecialMove(
  state: BattleState,
  user: Combatant,
  target: Combatant,
  move: MoveData,
  rng: Rng
): boolean {
  if (move.id === 'bide') {
    if (user.bideTurns === 0) {
      user.bideTurns = rng.int(2, 3);
      user.bideDamage = 0;
      log(state, `${user.species.name}이(가) 참기 시작했다.`, 'status');
      return true;
    }

    user.bideTurns -= 1;
    if (user.bideTurns > 0) {
      log(state, `${user.species.name}이(가) 공격을 참고 있다.`, 'status');
      return true;
    }

    if (user.bideDamage <= 0) {
      log(state, `${user.species.name}'s Bide failed.`, 'miss');
      return true;
    }

    const damage = user.bideDamage * 2;
    user.bideDamage = 0;
    applyDamage(state, target, damage, user, move, true);
    log(state, `${user.species.name}의 Bide가 ${damage} 피해로 폭발했다.`, 'hit');
    return true;
  }

  if (move.id === 'counter') {
    const lastMove = target.lastMove ? getMove(target.lastMove) : null;
    const lastSelectedMove = target.lastSelectedMove ? getMove(target.lastSelectedMove) : null;
    if (state.lastDamage <= 0 || !isCounterableMove(lastMove) || !isCounterableMove(lastSelectedMove)) {
      log(state, `${user.species.name}의 Counter는 실패했다.`, 'miss');
      return true;
    }

    const damage = state.lastDamage * 2;
    applyDamage(state, target, damage, user, move, true);
    log(state, `${user.species.name}의 Counter가 ${damage} 피해를 되돌렸다.`, 'hit');
    return true;
  }

  if (move.id === 'metronome') {
    const candidates = Object.values(dexData.moves).filter(candidate => candidate.id !== 'metronome');
    const calledMove = rng.pick(candidates);
    log(state, `손가락흔들기로 ${calledMove.name}이(가) 나왔다.`, 'status');
    executeMove(state, user, target, calledMove.id, rng, true);
    return true;
  }

  if (move.id === 'mirrormove') {
    if (!target.lastMove || target.lastMove === 'mirrormove') {
      log(state, `${user.species.name}의 Mirror Move는 실패했다.`, 'miss');
      return true;
    }
    executeMove(state, user, target, target.lastMove, rng, true);
    return true;
  }

  return false;
}

function executeMove(
  state: BattleState,
  user: Combatant,
  target: Combatant,
  moveId: string,
  rng: Rng,
  calledByOtherMove = false
): void {
  const move = getMove(moveId);
  if (calledByOtherMove) {
    event(state, {
      kind: 'move',
      turn: state.turn,
      side: user.side,
      targetSide: target.side,
      moveId: move.id,
      moveName: move.name,
      moveType: move.type,
      category: move.category,
    });
  }
  if (!calledByOtherMove) user.lastMove = move.id;

  if (target.lockedKind === 'rage' && (move.selfdestruct || move.id === 'disable') && target.hp > 0) {
    applyBoosts(state, target, {atk: 1}, target);
  }

  if (partialTrapMoves.has(move.id) && target.recharge) {
    target.recharge = false;
    log(state, `${target.species.name}'s recharge was cancelled.`, 'status');
  }

  if (move.thawsTarget || move.secondaries.some(secondary => secondary.status === 'brn')) {
    if (target.status === 'frz') {
      target.status = null;
      log(state, `${target.species.name}의 얼음이 녹았다.`, 'status');
    }
  }

  if (chargeMoves.has(move.id) && user.chargingMove !== move.id) {
    user.chargingMove = move.id;
    user.invulnerable = move.id === 'dig';
    if (move.self?.boosts) applyBoosts(state, user, move.self.boosts, user);
    log(state, `${user.species.name}이(가) ${move.name}을(를) 준비한다.`, 'status');
    return;
  }
  if (user.chargingMove === move.id) {
    user.chargingMove = null;
    user.invulnerable = false;
  }

  if (!hitsMove(state, user, target, move, rng)) {
    if (crashOnMissMoves.has(move.id)) {
      applyDamage(state, user, 1, null, null, false);
      log(state, `${user.species.name} crashed and took 1 damage.`, 'hit');
    }
    if (move.selfdestruct && user.hp > 0) {
      applyDamage(state, user, user.hp, null, null, false);
    }
    if (partialTrapMoves.has(move.id) && user.lockedKind === 'partialtrap') {
      user.lockedMove = null;
      user.lockedTurns = 0;
      user.lockedKind = null;
      user.lockedAccuracy = null;
      user.partialTrapDamage = null;
      target.partialTrapTurns = 0;
      target.partialTrapBy = null;
    }
    return;
  }
  if (executeSpecialMove(state, user, target, move, rng)) return;

  if (move.category === 'Status' && move.basePower === 0 && move.damage === null && !move.ohko) {
    executeStatusMove(state, user, target, move, rng);
  } else {
    executeDamagingMove(state, user, target, move, rng);
  }

  if (move.volatileStatus === 'partiallytrapped' && target.hp > 0) {
    applyVolatile(state, target, user, 'partiallytrapped', rng);
  }

  if (move.self?.volatileStatus === 'rage') {
    user.lockedMove = move.id;
    user.lockedTurns = 0;
    user.lockedKind = 'rage';
    user.lockedAccuracy = 255;
  }

  if (rampageMoves.has(move.id) && user.lockedTurns === 0) {
    user.lockedMove = move.id;
    user.lockedTurns = rng.int(2, 3);
    user.lockedKind = 'rampage';
    user.lockedAccuracy = 255;
    user.partialTrapDamage = null;
  }
}

function chooseMoveForTurn(combatant: Combatant, rng: Rng): string {
  if (combatant.bideTurns > 0) return 'bide';
  if (combatant.chargingMove) return combatant.chargingMove;
  if (combatant.lockedKind === 'rage' && combatant.lockedMove) return combatant.lockedMove;
  if (combatant.lockedMove && combatant.lockedTurns > 0) return combatant.lockedMove;

  const preferred = rng.chance(70) ? combatant.selectedMoves.attack : combatant.selectedMoves.support;
  const fallback = preferred === combatant.selectedMoves.attack ? combatant.selectedMoves.support : combatant.selectedMoves.attack;

  if (combatant.disabledMove === preferred && combatant.disabledMove !== fallback) return fallback;
  return preferred;
}

function beforeMove(state: BattleState, user: Combatant, target: Combatant, moveId: string, rng: Rng): boolean {
  if (user.hp <= 0 || target.hp <= 0) return false;

  if (user.partialTrapTurns > 0 && user.partialTrapBy !== null && state.sides[user.partialTrapBy].hp > 0) {
    user.partialTrapTurns -= 1;
    log(state, `${user.species.name}은(는) 묶여 움직일 수 없다.`, 'status');
    if (user.partialTrapTurns === 0) user.partialTrapBy = null;
    return false;
  }

  if (user.recharge) {
    user.recharge = false;
    log(state, `${user.species.name}은(는) 반동으로 움직일 수 없다.`, 'status');
    return false;
  }

  if (user.flinched) {
    log(state, `${user.species.name}은(는) 풀이 죽어 움직이지 못했다.`, 'status');
    return false;
  }

  if (user.status === 'slp') {
    user.statusTurns -= 1;
    log(state, `${user.species.name}은(는) 잠들어 있다.`, 'status');
    if (user.statusTurns <= 0) {
      user.status = null;
      event(state, {kind: 'status', turn: state.turn, side: user.side, status: 'slp', active: false});
      log(state, `${user.species.name}이(가) 잠에서 깼다.`, 'status');
    }
    return false;
  }

  if (user.status === 'frz') {
    log(state, `${user.species.name}은(는) 얼어 움직일 수 없다.`, 'status');
    return false;
  }

  if (user.status === 'par' && rng.int(1, 256) <= 63) {
    interruptLockedAction(user, user.invulnerable);
    log(state, `${user.species.name}은(는) 몸이 저려 움직일 수 없다.`, 'status');
    return false;
  }

  if (user.confusionTurns > 0) {
    user.confusionTurns -= 1;
    const confusionEnded = user.confusionTurns === 0;
    log(state, `${user.species.name}은(는) 혼란스럽다.`, 'status');
    if (confusionEnded) {
      log(state, `${user.species.name}???쇰?????몃떎.`, 'status');
      return true;
    }
    if (rng.int(1, 256) > 128) {
      const damage = calculateConfusionDamage(user);
      applyDamage(state, user, damage, user, null, false);
      interruptLockedAction(user);
      log(state, `${user.species.name}은(는) 혼란으로 스스로 ${damage} 피해를 받았다.`, 'hit');
      return false;
    }
    if (user.confusionTurns === 0) log(state, `${user.species.name}의 혼란이 풀렸다.`, 'status');
  }

  if (user.disabledTurns > 0) {
    user.disabledTurns -= 1;
    if (user.disabledTurns === 0) user.disabledMove = null;
  }

  if (user.disabledMove === moveId && user.disabledTurns > 0) {
    log(state, `${user.species.name}의 ${getMove(moveId).name}은(는) 봉인되어 실패했다.`, 'miss');
    return false;
  }

  return true;
}

function calculateConfusionDamage(user: Combatant): number {
  const attack = modifiedStat(user, 'atk', false);
  const defense = modifiedStat(user, 'def', false);
  const base = Math.floor(Math.floor((((Math.floor((2 * user.level) / 5) + 2) * 40 * attack) / defense) / 50) + 2);
  return Math.max(1, base);
}

function finishMove(state: BattleState, user: Combatant, moveId: string, rng: Rng): void {
  if (user.lockedMove === moveId && user.lockedTurns > 0) {
    user.lockedTurns -= 1;
    if (user.lockedTurns === 0 && user.lockedKind === 'rampage') {
      user.lockedMove = null;
      user.lockedKind = null;
      user.lockedAccuracy = null;
      user.confusionTurns = rng.int(2, 5);
      log(state, `${user.species.name}은(는) 난동 끝에 혼란에 빠졌다.`, 'status');
    } else if (user.lockedTurns === 0 && user.lockedKind === 'partialtrap') {
      user.lockedMove = null;
      user.lockedKind = null;
      user.lockedAccuracy = null;
      user.partialTrapDamage = null;
    }
  }
}

function applyResidual(state: BattleState): void {
  for (const combatant of state.sides) {
    if (combatant.hp <= 0) continue;

    if (combatant.status === 'brn' || combatant.status === 'psn') {
      const damage = Math.max(1, Math.floor(combatant.maxHp / 16));
      applyDamage(state, combatant, damage, null, null, false);
      log(state, `${combatant.species.name}은(는) ${statusLabels[combatant.status]}으로 ${damage} 피해를 받았다.`, 'hit');
    }

    if (combatant.leechSeedBy !== null && combatant.hp > 0) {
      const seeder = state.sides[combatant.leechSeedBy];
      const damage = Math.max(1, Math.floor(combatant.maxHp / 16));
      const dealt = applyDamage(state, combatant, damage, seeder, null, false);
      const restored = heal(state, seeder, damage);
      log(state, `${combatant.species.name}의 씨앗이 ${dealt} HP를 빼앗았다.`, 'hit');
      if (restored > 0) log(state, `${seeder.species.name}이(가) ${restored} HP를 회복했다.`, 'status');
    }

  }
}

function updateWinner(state: BattleState): void {
  const [left, right] = state.sides;
  if (left.hp <= 0 && right.hp <= 0) state.winner = 'draw';
  else if (left.hp <= 0) state.winner = 1;
  else if (right.hp <= 0) state.winner = 0;
  else if (state.turn >= maxTurns) state.winner = 'draw';
}

export function createBattle(seed = createSeed()): BattleState {
  const rng = createRng(seed);
  const [leftSpecies, rightSpecies] = chooseRandomSpeciesPair(rng);
  const left = createCombatant(0, leftSpecies, rng.int(5, 50), rng);
  const right = createCombatant(1, rightSpecies, rng.int(5, 50), rng);

  return {
    seed,
    rngState: rng.getState(),
    turn: 0,
    sides: [left, right],
    logs: [
      {turn: 0, text: `${left.species.name} Lv.${left.level} vs ${right.species.name} Lv.${right.level}`, tone: 'system'},
      {turn: 0, text: `시드 ${seed}로 전투를 시작했다.`, tone: 'system'},
    ],
    events: [],
    lastDamage: 0,
    lastDamageMoveType: null,
    lastDamageMoveId: null,
    winner: null,
  };
}

export function advanceTurn(state: BattleState): BattleState {
  if (state.winner !== null) return state;

  const rng = createRng(state.seed, state.rngState);
  state.turn += 1;
  state.events = [];
  log(state, `턴 ${state.turn}`, 'system');
  for (const combatant of state.sides) combatant.flinched = false;

  const choices = state.sides.map(combatant => chooseMoveForTurn(combatant, rng)) as [string, string];
  state.sides[0].lastSelectedMove = choices[0];
  state.sides[1].lastSelectedMove = choices[1];
  const order = ([0, 1] as SideId[]).sort((leftSide, rightSide) => {
    const leftMove = getMove(choices[leftSide]);
    const rightMove = getMove(choices[rightSide]);
    if (leftMove.priority !== rightMove.priority) return rightMove.priority - leftMove.priority;
    const speedDiff = effectiveSpeed(state.sides[rightSide]) - effectiveSpeed(state.sides[leftSide]);
    if (speedDiff !== 0) return speedDiff;
    return rng.chance(50) ? -1 : 1;
  });

  for (const side of order) {
    const user = state.sides[side];
    const target = opponentOf(state, user);
    const moveId = choices[side];
    user.lastSelectedMove = moveId;

    if (!beforeMove(state, user, target, moveId, rng)) {
      updateWinner(state);
      if (state.winner !== null) break;
      continue;
    }

    const move = getMove(moveId);
    event(state, {
      kind: 'move',
      turn: state.turn,
      side: user.side,
      targetSide: target.side,
      moveId: move.id,
      moveName: move.name,
      moveType: move.type,
      category: move.category,
    });
    log(state, `${user.species.name}은(는) ${move.name}을(를) 사용했다.`, 'system');
    executeMove(state, user, target, moveId, rng);
    finishMove(state, user, moveId, rng);
    updateWinner(state);
    if (state.winner !== null) break;
  }

  if (state.winner === null) {
    applyResidual(state);
    updateWinner(state);
  }

  if (state.winner !== null) {
    const text = state.winner === 'draw' ? '전투가 무승부로 끝났다.' : `${state.sides[state.winner].species.name}의 승리!`;
    log(state, text, state.winner === 'draw' ? 'system' : 'ko');
    event(state, {kind: 'winner', turn: state.turn, winner: state.winner});
  }

  state.rngState = rng.getState();
  return state;
}

export function runBattle(seed: string, turns = maxTurns): BattleState {
  const state = createBattle(seed);
  while (state.winner === null && state.turn < turns) advanceTurn(state);
  return state;
}
