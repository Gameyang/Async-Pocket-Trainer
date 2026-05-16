import {describe, expect, it} from 'vitest';
import {advanceTurn, createBattle, runBattle} from './battle';
import {dexData, getMove, getTypeMultiplier} from './dex';
import {getSpecies} from './dex';
import {createRng} from './rng';
import {createCombatant} from './teamBuilder';
import {selectMovesForLevel} from './teamBuilder';
import {validateRuntimeBattleData} from './runtimeValidation';
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
    const runtimeValidation = validateRuntimeBattleData();
    expect(validation.errors).toEqual([]);
    expect(runtimeValidation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
    expect(runtimeValidation.ok).toBe(true);
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

  it('emits structured events for the battle screen', () => {
    const battle = createBattle('event-check');
    advanceTurn(battle);

    expect(battle.events.some(event => event.kind === 'move')).toBe(true);
    expect(battle.events.some(event => event.kind === 'message')).toBe(true);
  });

  it('finishes representative random battles within the turn cap', () => {
    for (let index = 0; index < 20; index += 1) {
      const result = runBattle(`smoke-${index}`);
      expect(result.winner, `seed smoke-${index}`).not.toBeNull();
      expect(result.turn).toBeLessThanOrEqual(200);
    }
  });
});

describe('Gen1 move mechanics', () => {
  function forcedBattle(leftSpecies: string, rightSpecies: string, leftMove: string, rightMove = 'splash') {
    const battle = createBattle(`forced-${leftSpecies}-${rightSpecies}-${leftMove}-${rightMove}`);
    battle.sides[0] = createCombatant(0, getSpecies(leftSpecies), 50, createRng('left'));
    battle.sides[1] = createCombatant(1, getSpecies(rightSpecies), 50, createRng('right'));
    battle.sides[0].selectedMoves = {attack: leftMove, support: leftMove};
    battle.sides[1].selectedMoves = {attack: rightMove, support: rightMove};
    battle.sides[0].hp = battle.sides[0].maxHp;
    battle.sides[1].hp = battle.sides[1].maxHp;
    battle.rngState = createRng('forced-rng').getState();
    return battle;
  }

  it('keeps fallback moves while requiring every generated move to exist in the battle dex', () => {
    for (const id of Object.keys(dexData.moves)) {
      expect(getMove(id).id).toBe(id);
    }
    expect(Object.keys(dexData.moves)).toHaveLength(147);
  });

  it('blocks Electric Thunder Wave against Ground targets through Gen1 type immunity', () => {
    const battle = forcedBattle('pikachu', 'diglett', 'thunderwave');
    advanceTurn(battle);
    expect(battle.sides[1].status).toBeNull();
  });

  it('prevents same-type secondary status such as Body Slam paralyzing Normal targets', () => {
    const battle = forcedBattle('snorlax', 'rattata', 'bodyslam');
    for (let index = 0; index < 12 && battle.sides[1].status === null; index += 1) advanceTurn(battle);
    expect(battle.sides[1].status).toBeNull();
  });

  it('uses Hyper Beam recharge only when the target survives', () => {
    const battle = forcedBattle('mewtwo', 'snorlax', 'hyperbeam');
    advanceTurn(battle);
    expect(battle.sides[0].recharge).toBe(true);
  });

  it('lets Rest heal and replace an existing major status with sleep', () => {
    const battle = forcedBattle('snorlax', 'magikarp', 'rest');
    battle.sides[0].hp = Math.max(1, battle.sides[0].maxHp - 20);
    battle.sides[0].status = 'par';
    advanceTurn(battle);
    expect(battle.sides[0].hp).toBe(battle.sides[0].maxHp);
    expect(battle.sides[0].status).toBe('slp');
  });

  it('keeps Dig users invulnerable during the charging turn', () => {
    const battle = forcedBattle('dugtrio', 'snorlax', 'dig', 'tackle');
    advanceTurn(battle);
    expect(battle.sides[0].invulnerable).toBe(true);
    expect(battle.logs.some(entry => entry.tone === 'miss')).toBe(true);
    advanceTurn(battle);
    expect(battle.sides[0].invulnerable).toBe(false);
  });

  it('applies one point crash damage to missed Jump Kick moves', () => {
    const battle = forcedBattle('hitmonlee', 'gastly', 'jumpkick');
    const before = battle.sides[0].hp;
    advanceTurn(battle);
    expect(battle.sides[0].hp).toBe(before - 1);
  });

  it('prevents Dream Eater unless the target is asleep', () => {
    const battle = forcedBattle('gengar', 'snorlax', 'dreameater');
    const before = battle.sides[1].hp;
    advanceTurn(battle);
    expect(battle.sides[1].hp).toBe(before);
  });

  it('doubles the last Normal or Fighting damage with Counter', () => {
    const battle = forcedBattle('snorlax', 'rattata', 'counter', 'tackle');
    advanceTurn(battle);
    const damageEvents = battle.events.flatMap(event => event.kind === 'damage' && event.direct ? [event.amount] : []);
    expect(damageEvents).toHaveLength(2);
    expect(damageEvents[1]).toBe(damageEvents[0] * 2);
  });

  it('rejects Counter when the last selected move is not counterable', () => {
    const battle = forcedBattle('snorlax', 'mewtwo', 'counter', 'confusion');
    const before = battle.sides[1].hp;
    advanceTurn(battle);
    expect(battle.sides[1].hp).toBe(before);
  });

  it('locks partial trapping moves and prevents the trapped target action', () => {
    const battle = forcedBattle('dragonite', 'snorlax', 'wrap', 'tackle');
    battle.sides[0].boosts.accuracy = 6;
    advanceTurn(battle);
    const moveEvents = battle.events.flatMap(event => event.kind === 'move' ? [event.moveId] : []);
    expect(moveEvents).toEqual(['wrap']);
    expect(battle.sides[0].lockedKind).toBe('partialtrap');
    expect(battle.sides[1].partialTrapBy).toBe(0);
  });

  it('lets Substitute block opposing stat drops', () => {
    const battle = forcedBattle('alakazam', 'rattata', 'substitute', 'tailwhip');
    advanceTurn(battle);
    expect(battle.sides[0].substituteHp).toBeGreaterThan(0);
    expect(battle.sides[0].boosts.def).toBe(0);
  });

  it('uses Haze to clear opponent status and both sides stat changes', () => {
    const battle = forcedBattle('gengar', 'rattata', 'haze');
    battle.sides[0].status = 'brn';
    battle.sides[0].boosts.spe = 2;
    battle.sides[1].status = 'par';
    battle.sides[1].boosts.atk = 3;
    advanceTurn(battle);
    expect(battle.sides[0].status).toBe('brn');
    expect(battle.sides[0].boosts.spe).toBe(0);
    expect(battle.sides[1].status).toBeNull();
    expect(battle.sides[1].boosts.atk).toBe(0);
  });

  it('copies target type and selected moves with Transform', () => {
    const battle = forcedBattle('ditto', 'charizard', 'transform', 'splash');
    advanceTurn(battle);
    expect(battle.sides[0].transformedTypes).toEqual(battle.sides[1].species.types);
    expect(battle.sides[0].selectedMoves).toEqual(battle.sides[1].selectedMoves);
  });
});
