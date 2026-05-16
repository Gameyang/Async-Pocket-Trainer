import {getMove} from '../dex';
import {createRng} from '../rng';
import type {Rng} from '../rng';
import type {BattleState, Combatant, SideId} from '../types';
import {maxTurns} from './constants';
import {applyDamage, applyResidual} from './effects';
import {interruptLockedAction} from './locks';
import {executeMove} from './moves';
import {event, log, opponentOf} from './state';
import {calculateConfusionDamage, effectiveSpeed} from './stats';

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

function updateWinner(state: BattleState): void {
  const [left, right] = state.sides;
  if (left.hp <= 0 && right.hp <= 0) state.winner = 'draw';
  else if (left.hp <= 0) state.winner = 1;
  else if (right.hp <= 0) state.winner = 0;
  else if (state.turn >= maxTurns) state.winner = 'draw';
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

