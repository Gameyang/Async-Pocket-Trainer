export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(percent: number): boolean;
  getState(): number;
  setState(state: number): void;
}

function hashSeed(seed: string): number {
  let hash = 1779033703 ^ seed.length;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function createSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createRng(seed: string, initialState = hashSeed(seed)): Rng {
  let state = initialState >>> 0;

  const rng: Rng = {
    next() {
      state = (state + 0x6D2B79F5) >>> 0;
      let mixed = state;
      mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
      mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    },
    int(min: number, max: number) {
      return Math.floor(rng.next() * (max - min + 1)) + min;
    },
    pick<T>(items: readonly T[]) {
      if (items.length === 0) throw new Error('Cannot pick from an empty list.');
      return items[rng.int(0, items.length - 1)];
    },
    chance(percent: number) {
      return rng.next() * 100 < percent;
    },
    getState() {
      return state >>> 0;
    },
    setState(nextState: number) {
      state = nextState >>> 0;
    },
  };

  return rng;
}
