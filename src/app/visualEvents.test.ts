import {describe, expect, it} from 'vitest';
import {createBattle} from '../core/battle';
import type {BattleEvent} from '../core/types';
import {audioCueForEvent} from './audio';
import {applyVisualEvent, createInitialVisualState} from './visualEvents';

describe('battle app visual events', () => {
  it('creates the initial visual state from the battle state', () => {
    const battle = createBattle('visual-seed');
    const visual = createInitialVisualState(battle);

    expect(visual.hp).toEqual([battle.sides[0].hp, battle.sides[1].hp]);
    expect(visual.seedDraft).toBe('visual-seed');
    expect(visual.eventQueue).toEqual([]);
    expect(visual.message).toBe(`${battle.sides[0].species.name}와 ${battle.sides[1].species.name}의 전투가 시작됐다!`);
  });

  it('applies move and damage events without leaking previous animation slots', () => {
    const battle = createBattle('visual-events');
    const visual = createInitialVisualState(battle);
    const moveEvent: BattleEvent = {
      kind: 'move',
      turn: 1,
      side: 0,
      targetSide: 1,
      moveId: 'tackle',
      moveName: 'Tackle',
      moveType: 'Normal',
      category: 'Physical',
    };
    const damageEvent: BattleEvent = {
      kind: 'damage',
      turn: 1,
      side: 1,
      sourceSide: 0,
      amount: 12,
      hp: 24,
      maxHp: battle.sides[1].maxHp,
      moveId: 'tackle',
      direct: true,
    };

    expect(applyVisualEvent(visual, battle, moveEvent)).toBe(520);
    expect(visual.activeSide).toBe(0);
    expect(visual.animation).toBe('attack');
    expect(visual.message).toBe(`${battle.sides[0].species.name}의 Tackle!`);

    expect(applyVisualEvent(visual, battle, damageEvent)).toBe(460);
    expect(visual.activeSide).toBeNull();
    expect(visual.impactSide).toBe(1);
    expect(visual.animation).toBe('impact');
    expect(visual.hp[1]).toBe(24);
  });

  it('maps battle events to stable audio cues', () => {
    const statusMove: BattleEvent = {
      kind: 'move',
      turn: 1,
      side: 0,
      targetSide: 1,
      moveId: 'growl',
      moveName: 'Growl',
      moveType: 'Normal',
      category: 'Status',
    };
    const damage: BattleEvent = {
      kind: 'damage',
      turn: 1,
      side: 1,
      sourceSide: 0,
      amount: 5,
      hp: 20,
      maxHp: 25,
      moveId: 'tackle',
      direct: true,
    };

    expect(audioCueForEvent(statusMove)).toEqual({
      path: 'audio/sfx/battle/support/battle-support-type-normal.m4a',
      volume: 0.28,
    });
    expect(audioCueForEvent(damage)).toEqual({
      path: 'audio/sfx/battle/core/battle-hit.m4a',
      volume: 0.34,
    });
  });
});
