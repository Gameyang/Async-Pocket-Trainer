import {getMove} from '../dex';
import type {Rng} from '../rng';
import type {BattleState, BoostId, Combatant, MajorStatus, MoveData} from '../types';
import {boostIds, boostLabels, statusLabels} from './constants';
import {activeTypes, event, log} from './state';
import {clamp} from './utils';

export function heal(state: BattleState, combatant: Combatant, amount: number): number {
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

export function applyDamage(
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

export function clearBoosts(combatant: Combatant): void {
  for (const boost of boostIds) combatant.boosts[boost] = 0;
}

export function applyBoosts(
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

export function applyMajorStatus(
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

export function applyVolatile(
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

export function applyResidual(state: BattleState): void {
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

