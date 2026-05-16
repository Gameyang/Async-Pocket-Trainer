import {imagePathForSpecies} from '../../core/dex';
import type {BattleState, SideId} from '../../core/types';
import {escapeHtml} from '../html';
import type {VisualState} from '../types';

export function renderSprite(battle: BattleState, visual: VisualState, side: SideId): string {
  const combatant = battle.sides[side];
  const role = side === 0 ? 'player' : 'enemy';
  const active = visual.activeSide === side ? 'is-attacking' : '';
  const impact = visual.impactSide === side ? 'is-hit' : '';
  const status = visual.statusSide === side ? 'is-statused' : '';
  const fainted = combatant.hp <= 0 ? 'is-fainted' : '';

  return `
    <div class="sprite-slot ${role}">
      <div class="platform"></div>
      <img
        class="pokemon-sprite ${role} ${active} ${impact} ${status} ${fainted}"
        src="${imagePathForSpecies(combatant.species)}"
        alt="${escapeHtml(combatant.species.name)}"
      />
    </div>
  `;
}
