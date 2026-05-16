import {dexData, getMove, getTypeMultiplier} from './dex';
import {createRng, createSeed, type Rng} from './rng';
import {chooseRandomSpeciesPair, createCombatant} from './teamBuilder';
import type {BattleEvent, BattleLogEntry, BattleState, BoostId, Combatant, MajorStatus, MoveData, MoveSecondary, SideId, StatId} from './types';

const maxTurns = 200;
const chargeMoves = new Set(['dig', 'skullbash', 'skyattack', 'solarbeam', 'razorwind']);
const rampageMoves = new Set(['thrash', 'petaldance']);
const inertMoves = new Set(['splash', 'teleport', 'roar', 'whirlwind']);
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

function accuracyStageMultiplier(stage: number): number {
  return stage >= 0 ? (3 + stage) / 3 : 3 / (3 - stage);
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
    target.lastDamageCategory = move.category;
    if (target.bideTurns > 0) target.bideDamage += actual;
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

function canReceiveStatus(target: Combatant, source: Combatant, status: MajorStatus, move: MoveData): boolean {
  const types = activeTypes(target);
  if (target.status) return false;
  if (target.substituteHp > 0 && source.side !== target.side) return false;
  if (status === 'brn' && types.includes('Fire')) return false;
  if (status === 'frz' && types.includes('Ice')) return false;
  if (status === 'psn' && types.includes('Poison')) return false;
  if (move.flags?.powder && types.includes('Grass')) return false;
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
  target.statusTurns = status === 'slp' ? rng.int(1, 7) : 0;
  event(state, {kind: 'status', turn: state.turn, side: target.side, status, active: true});
  log(state, `${target.species.name}은(는) ${statusLabels[status]} 상태가 되었다.`, 'status');
  return true;
}

function applyVolatile(state: BattleState, target: Combatant, source: Combatant, volatile: string, rng: Rng): boolean {
  if (target.substituteHp > 0 && source.side !== target.side && !['flinch', 'partiallytrapped'].includes(volatile)) {
    log(state, `${target.species.name}의 대타가 상태 변화를 막았다.`, 'miss');
    return false;
  }

  switch (volatile) {
    case 'confusion':
      target.confusionTurns = rng.int(2, 5);
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'confusion', active: true});
      log(state, `${target.species.name}은(는) 혼란에 빠졌다.`, 'status');
      return true;
    case 'flinch':
      target.flinched = true;
      return true;
    case 'leechseed':
      if (activeTypes(target).includes('Grass')) {
        log(state, `${target.species.name}에게 씨뿌리기는 통하지 않았다.`, 'miss');
        return false;
      }
      target.leechSeedBy = source.side;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'leechseed', active: true});
      log(state, `${target.species.name}에게 씨앗이 심어졌다.`, 'status');
      return true;
    case 'partiallytrapped':
      target.partialTrapTurns = rng.int(2, 5);
      target.partialTrapBy = source.side;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'partiallytrapped', active: true});
      log(state, `${target.species.name}은(는) 움직임이 봉쇄됐다.`, 'status');
      return true;
    case 'disable':
      target.disabledMove = rng.pick([target.selectedMoves.attack, target.selectedMoves.support]);
      target.disabledTurns = rng.int(1, 7);
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'disable', active: true});
      log(state, `${target.species.name}의 ${getMove(target.disabledMove).name}이(가) 봉인됐다.`, 'status');
      return true;
    case 'focusenergy':
      target.focusEnergy = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'focusenergy', active: true});
      log(state, `${target.species.name}은(는) 급소를 노린다.`, 'status');
      return true;
    case 'substitute':
      return createSubstitute(state, target);
    case 'mist':
      target.mist = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'mist', active: true});
      log(state, `${target.species.name}이(가) 흰안개에 둘러싸였다.`, 'status');
      return true;
    case 'lightscreen':
      target.lightScreen = true;
      event(state, {kind: 'status', turn: state.turn, side: target.side, status: 'lightscreen', active: true});
      log(state, `${target.species.name}이(가) 빛의장막을 펼쳤다.`, 'status');
      return true;
    case 'reflect':
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
  if (user.substituteHp > 0 || user.hp <= cost) {
    log(state, `${user.species.name}은(는) 대타를 만들 수 없다.`, 'miss');
    return false;
  }

  user.hp -= cost;
  user.substituteHp = cost;
  event(state, {
    kind: 'damage',
    turn: state.turn,
    side: user.side,
    sourceSide: user.side,
    amount: cost,
    hp: user.hp,
    maxHp: user.maxHp,
    moveId: 'substitute',
    direct: false,
  });
  event(state, {kind: 'status', turn: state.turn, side: user.side, status: 'substitute', active: true});
  log(state, `${user.species.name}이(가) HP를 깎아 대타를 만들었다.`, 'status');
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
    if (target.hp <= 0 || !rng.chance(secondary.chance)) continue;
    applyMoveEffect(state, source, target, move, secondary, rng);
  }
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
  if (effect.volatileStatus) applyVolatile(state, target, source, effect.volatileStatus, rng);
  if (effect.boosts) applyBoosts(state, target, effect.boosts, source);
}

function hitsMove(state: BattleState, user: Combatant, target: Combatant, move: MoveData, rng: Rng): boolean {
  const multiplier = getTypeMultiplier(move.type, activeTypes(target));
  if (!move.ignoreImmunity && multiplier === 0 && move.type !== '???') {
    event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
    log(state, `${target.species.name}에게는 효과가 없다.`, 'miss');
    return false;
  }

  if (move.accuracy === true) {
    if (move.id !== 'swift' && rng.int(1, 256) === 1) {
      event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
      log(state, `${user.species.name}의 ${move.name}이(가) 빗나갔다.`, 'miss');
      return false;
    }
    return true;
  }

  const accuracy = move.accuracy *
    accuracyStageMultiplier(user.boosts.accuracy) /
    accuracyStageMultiplier(target.boosts.evasion);

  if (!rng.chance(clamp(accuracy, 1, 100))) {
    event(state, {kind: 'miss', turn: state.turn, side: user.side, targetSide: target.side, moveId: move.id});
    log(state, `${user.species.name}의 ${move.name}이(가) 빗나갔다.`, 'miss');
    return false;
  }

  return true;
}

function isCriticalHit(user: Combatant, move: MoveData, rng: Rng): boolean {
  const baseSpeed = user.species.baseStats.spe;
  const divisor = move.critRatio > 1 ? 64 : 512;
  const focusPenalty = user.focusEnergy ? 4 : 1;
  return rng.next() < Math.min(255 / 256, baseSpeed / divisor / focusPenalty);
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
  attack = Math.max(1, attack);
  defense = Math.max(1, defense);

  const damageLevel = critical ? user.level * 2 : user.level;
  const base = Math.floor(Math.floor((((Math.floor((2 * damageLevel) / 5) + 2) * move.basePower * attack) / defense) / 50) + 2);
  const stab = activeTypes(user).includes(move.type) ? 1.5 : 1;
  const randomFactor = rng.int(217, 255) / 255;
  const damage = Math.max(1, Math.floor(base * stab * multiplier * randomFactor));

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
  totalDamage: number
): void {
  if (move.drain && totalDamage > 0) {
    const restored = heal(state, user, Math.floor((totalDamage * move.drain[0]) / move.drain[1]));
    if (restored > 0) log(state, `${user.species.name}이(가) ${restored} HP를 흡수했다.`, 'status');
  }

  if (move.recoil && totalDamage > 0 && user.hp > 0) {
    const recoil = Math.max(1, Math.floor((totalDamage * move.recoil[0]) / move.recoil[1]));
    applyDamage(state, user, recoil, null, null, false);
    log(state, `${user.species.name}이(가) 반동으로 ${recoil} 피해를 받았다.`, 'hit');
  }

  if (move.selfdestruct && user.hp > 0) {
    applyDamage(state, user, user.hp, null, null, false);
    log(state, `${user.species.name}은(는) 폭발의 반동으로 쓰러졌다.`, 'ko');
  }

  if (move.self?.volatileStatus === 'mustrecharge' && target.hp > 0) {
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
  const hits = multihitCount(move, rng);

  for (let hit = 0; hit < hits && target.hp > 0; hit += 1) {
    const result = calculateDamage(user, target, move, rng);
    if (result.damage <= 0) {
      log(state, `${target.species.name}에게는 효과가 없다.`, 'miss');
      return;
    }

    const dealt = applyDamage(state, target, result.damage, user, move, true);
    totalDamage += dealt;
    const effectiveness = result.multiplier > 1 ? ' 효과가 굉장했다.' : result.multiplier > 0 && result.multiplier < 1 ? ' 효과가 별로였다.' : '';
    const critical = result.critical ? ' 급소에 맞았다.' : '';
    log(state, `${user.species.name}의 ${move.name}: ${dealt} 피해.${critical}${effectiveness}`, 'hit');
  }

  if (hits > 1) log(state, `${move.name}은(는) ${hits}번 맞았다.`, 'hit');
  applyAfterDamageEffects(state, user, target, move, totalDamage);
  if (target.hp > 0) applySecondaryEffects(state, user, target, move, rng);
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
    const restored = heal(state, user, Math.floor(user.maxHp / 2));
    log(state, `${user.species.name}이(가) ${restored} HP를 회복했다.`, 'status');
    return;
  }

  if (move.id === 'rest') {
    heal(state, user, user.maxHp);
    user.status = 'slp';
    user.statusTurns = 2;
    log(state, `${user.species.name}이(가) 잠들고 HP를 모두 회복했다.`, 'status');
    return;
  }

  if (move.id === 'haze') {
    for (const side of state.sides) {
      clearBoosts(side);
      side.confusionTurns = 0;
      side.focusEnergy = false;
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
    user.transformedTypes = [getMove(user.selectedMoves.attack).type];
    log(state, `${user.species.name}의 타입이 ${user.transformedTypes[0]} 타입이 되었다.`, 'status');
    return;
  }

  if (move.heal) {
    const restored = heal(state, user, Math.floor((user.maxHp * move.heal[0]) / move.heal[1]));
    log(state, `${user.species.name}이(가) ${restored} HP를 회복했다.`, 'status');
    return;
  }

  if (move.status) applyMajorStatus(state, target, move.status, user, move, rng);
  if (move.volatileStatus) applyVolatile(state, move.target === 'self' ? user : target, user, move.volatileStatus, rng);
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

    const damage = Math.max(1, user.bideDamage * 2);
    user.bideDamage = 0;
    applyDamage(state, target, damage, user, move, true);
    log(state, `${user.species.name}의 Bide가 ${damage} 피해로 폭발했다.`, 'hit');
    return true;
  }

  if (move.id === 'counter') {
    if (user.lastDamageTaken <= 0 || user.lastDamageCategory !== 'Physical') {
      log(state, `${user.species.name}의 Counter는 실패했다.`, 'miss');
      return true;
    }

    const damage = user.lastDamageTaken * 2;
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
    if (!target.lastMove) {
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

  if (move.thawsTarget || move.type === 'Fire') {
    if (target.status === 'frz') {
      target.status = null;
      log(state, `${target.species.name}의 얼음이 녹았다.`, 'status');
    }
  }

  if (chargeMoves.has(move.id) && user.chargingMove !== move.id) {
    user.chargingMove = move.id;
    if (move.self?.boosts) applyBoosts(state, user, move.self.boosts, user);
    log(state, `${user.species.name}이(가) ${move.name}을(를) 준비한다.`, 'status');
    return;
  }
  if (user.chargingMove === move.id) user.chargingMove = null;

  if (!hitsMove(state, user, target, move, rng)) return;
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
    user.lockedTurns = 1;
  }

  if (rampageMoves.has(move.id) && user.lockedTurns === 0) {
    user.lockedMove = move.id;
    user.lockedTurns = rng.int(2, 3);
  }
}

function chooseMoveForTurn(combatant: Combatant, rng: Rng): string {
  if (combatant.bideTurns > 0) return 'bide';
  if (combatant.chargingMove) return combatant.chargingMove;
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

  if (user.status === 'par' && rng.chance(25)) {
    log(state, `${user.species.name}은(는) 몸이 저려 움직일 수 없다.`, 'status');
    return false;
  }

  if (user.confusionTurns > 0) {
    user.confusionTurns -= 1;
    log(state, `${user.species.name}은(는) 혼란스럽다.`, 'status');
    if (rng.chance(50)) {
      const damage = calculateConfusionDamage(user, rng);
      applyDamage(state, user, damage, user, null, false);
      log(state, `${user.species.name}은(는) 혼란으로 스스로 ${damage} 피해를 받았다.`, 'hit');
      return false;
    }
    if (user.confusionTurns === 0) log(state, `${user.species.name}의 혼란이 풀렸다.`, 'status');
  }

  if (user.disabledMove === moveId && user.disabledTurns > 0) {
    log(state, `${user.species.name}의 ${getMove(moveId).name}은(는) 봉인되어 실패했다.`, 'miss');
    return false;
  }

  return true;
}

function calculateConfusionDamage(user: Combatant, rng: Rng): number {
  const attack = modifiedStat(user, 'atk', false);
  const defense = modifiedStat(user, 'def', false);
  const base = Math.floor(Math.floor((((Math.floor((2 * user.level) / 5) + 2) * 40 * attack) / defense) / 50) + 2);
  return Math.max(1, Math.floor(base * (rng.int(217, 255) / 255)));
}

function finishMove(state: BattleState, user: Combatant, moveId: string): void {
  if (user.lockedMove === moveId && user.lockedTurns > 0) {
    user.lockedTurns -= 1;
    if (user.lockedTurns === 0 && rampageMoves.has(moveId)) {
      user.lockedMove = null;
      user.confusionTurns = 2;
      log(state, `${user.species.name}은(는) 난동 끝에 혼란에 빠졌다.`, 'status');
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
      const restored = heal(state, seeder, dealt);
      log(state, `${combatant.species.name}의 씨앗이 ${dealt} HP를 빼앗았다.`, 'hit');
      if (restored > 0) log(state, `${seeder.species.name}이(가) ${restored} HP를 회복했다.`, 'status');
    }

    if (combatant.disabledTurns > 0) {
      combatant.disabledTurns -= 1;
      if (combatant.disabledTurns === 0) {
        combatant.disabledMove = null;
        log(state, `${combatant.species.name}의 봉인이 풀렸다.`, 'status');
      }
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
    finishMove(state, user, moveId);
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
