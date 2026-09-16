/**
 * Shuffle-bag phrase picker — draws without replacement until the pool is exhausted, then
 * reshuffles. One instance per phrase tier, living for the app's lifetime so its cycle spans
 * every turn, not just one. Detects a pool edit (compared as a set) and refills immediately.
 */

export interface ShuffleBag {
  /** Draws the next phrase from `pool`. Undefined for an empty pool. */
  draw(pool: string[]): string | undefined;
}

export function createShuffleBag(rng: () => number = Math.random): ShuffleBag {
  let remaining: string[] = [];
  let currentSet: Set<string> | undefined;
  let lastDrawn: string | undefined;

  function poolChanged(pool: string[]): boolean {
    if (!currentSet || currentSet.size !== pool.length) return true;
    return pool.some((phrase) => !currentSet!.has(phrase));
  }

  // Fisher-Yates, then — if the fresh first item would repeat the previous draw — swap it later.
  function refill(pool: string[]): void {
    const shuffled = [...pool];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    if (shuffled.length > 1 && shuffled[0] === lastDrawn) {
      const swapAt = 1 + Math.floor(rng() * (shuffled.length - 1));
      [shuffled[0], shuffled[swapAt]] = [shuffled[swapAt]!, shuffled[0]!];
    }
    remaining = shuffled;
    currentSet = new Set(pool);
  }

  return {
    draw(pool) {
      if (pool.length === 0) return undefined;
      if (poolChanged(pool) || remaining.length === 0) refill(pool);
      const item = remaining.shift()!;
      lastDrawn = item;
      return item;
    },
  };
}
