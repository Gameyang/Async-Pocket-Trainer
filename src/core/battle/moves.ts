import {dexData, getMove, getTypeMultiplier} from '../dex';
import type {Rng} from '../rng';
import type {BattleState, Combatant, MoveData, MoveSecondary} from '../types';
import {chargeMoves, crashOnMissMoves, inertMoves, partialTrapMoves, rampageMoves, selfTargetVolatiles} from './constants';
import {applyBoosts, applyDamage, applyMajorStatus, applyVolatile, clearBoosts, heal} from './effects';
import {activeTypes, event, log} from './state';
import {accuracyStagePercent, effectiveSpeed, modifiedStat} from './stats';
import {clamp} from './utils';

function isCounterableMove(move: MoveData | null): boolean {
  return Boolean(move && move.basePower > 0 && move.id !== 'counter' && ['Normal', 'Fighting'].includes(move.type));
}

function recoveryGlitchFails(combatant: Combatant): boolean {
  return combatant.hp === combatant.maxHp ||
    ((combatant.hp === combatant.maxHp - 255 || combatant.hp === combatant.maxHp - 511) && combatant.hp % 256 !== 0);
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

export function executeMove(
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

