export class SeededRng {
  private state: number;

  constructor(seed: string | number) {
    const normalized = typeof seed === "number" ? seed >>> 0 : hashSeed(seed);
    this.state = normalized === 0 ? 0x6d2b79f5 : normalized;
  }

  getState(): number {
    return this.state >>> 0;
  }

  nextUint(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextFloat(): number {
    return this.nextUint() / 0x100000000;
  }

  int(minInclusive: number, maxInclusive: number): number {
    const min = Math.ceil(minInclusive);
    const max = Math.floor(maxInclusive);
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  chance(probability: number): boolean {
    return this.nextFloat() < clamp(probability, 0, 1);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot pick from an empty collection.");
    }

    return items[this.int(0, items.length - 1)];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const result = [...items];

    for (let index = result.length - 1; index > 0; index -= 1) {
      const swapIndex = this.int(0, index);
      [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    }

    return result;
  }
}

export function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
