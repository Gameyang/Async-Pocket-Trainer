import type {BoostId, MajorStatus} from '../types';

export const maxTurns = 200;
export const chargeMoves = new Set(['dig', 'skullbash', 'skyattack', 'solarbeam', 'razorwind']);
export const rampageMoves = new Set(['thrash', 'petaldance']);
export const inertMoves = new Set(['splash', 'teleport', 'roar', 'whirlwind']);
export const partialTrapMoves = new Set(['bind', 'wrap', 'clamp', 'firespin']);
export const crashOnMissMoves = new Set(['jumpkick', 'highjumpkick']);
export const selfTargetVolatiles = new Set(['focusenergy', 'substitute', 'mist', 'lightscreen', 'reflect']);
export const accuracyBoostTable = [25, 28, 33, 40, 50, 66, 100, 150, 200, 250, 300, 350, 400];
export const boostIds: BoostId[] = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'];

export const statusLabels: Record<MajorStatus, string> = {
  brn: '화상',
  par: '마비',
  psn: '독',
  slp: '수면',
  frz: '얼음',
};

export const boostLabels: Record<BoostId, string> = {
  atk: '공격',
  def: '방어',
  spa: '특수',
  spd: '특수방어',
  spe: '스피드',
  accuracy: '명중',
  evasion: '회피',
};

