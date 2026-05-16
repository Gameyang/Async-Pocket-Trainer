import type {Combatant} from '../types';

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

