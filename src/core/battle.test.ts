import {describe, expect, it} from 'vitest';
import {advanceTurn, createBattle, runBattle} from './battle';
import {dexData, getMove, getTypeMultiplier} from './dex';
import {createRng} from './rng';
import {selectMovesForLevel} from './teamBuilder';
import {validateBattleData} from './validation';

function isAttack(moveId: string): boolean {
  const move = getMove(moveId);
  return move.basePower > 0 || move.damage !== null || move.ohko;
}

function isSupport(moveId: string): boolean {
  const move = getMove(moveId);
  return move.category === 'Status' && !isAttack(moveId);
}

describe('Gen1 battle MVP data', () => {
  it('contains the original 151 species and their local images', () => {
    const validation = validateBattleData(true);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(dexData.species).toHaveLength(151);
  });

  it('selects one attack and one support move at low, mid, and high MVP levels', () => {
    for (const species of dexData.species) {
      for (const level of [5, 15, 50]) {
        const moves = selectMovesForLevel(species, level, createRng(`${species.id}-${level}`));
        expect(isAttack(moves.attack), `${species.name} Lv.${level} attack`).toBe(true);
        expect(isSupport(moves.support), `${species.name} Lv.${level} support`).toBe(true);
      }
    }
  });

  it('uses Gen1 type effectiveness', () => {
    expect(getTypeMultiplier('Fire', ['Grass'])).toBe(2);
    expect(getTypeMultiplier('Electric', ['Ground'])).toBe(0);
    expect(getTypeMultiplier('Ghost', ['Normal'])).toBe(0);
    expect(getTypeMultiplier('Ice', ['Dragon', 'Flying'])).toBe(4);
  });
});

describe('auto battle simulation', () => {
  it('is reproducible from the same seed', () => {
    const first = runBattle('fixed-seed-001');
    const second = runBattle('fixed-seed-001');

    expect(first.winner).toEqual(second.winner);
    expect(first.turn).toBe(second.turn);
    expect(first.logs.map(entry => entry.text)).toEqual(second.logs.map(entry => entry.text));
  });

  it('advances turns without changing the selected fixed moves', () => {
    const battle = createBattle('move-lock-check');
    const originalMoves = battle.sides.map(side => ({...side.selectedMoves}));
    advanceTurn(battle);
    advanceTurn(battle);

    expect(battle.sides.map(side => side.selectedMoves)).toEqual(originalMoves);
  });

  it('finishes representative random battles within the turn cap', () => {
    for (let index = 0; index < 20; index += 1) {
      const result = runBattle(`smoke-${index}`);
      expect(result.winner, `seed smoke-${index}`).not.toBeNull();
      expect(result.turn).toBeLessThanOrEqual(200);
    }
  });
});
