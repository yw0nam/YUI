/**
 * shuffle-bag.test.ts — draw-without-replacement-until-exhausted phrase picker.
 *
 * Pins the contract for src/io/shuffle-bag.ts: createShuffleBag(rng).draw(pool).
 */

import { describe, expect, it } from "vitest";
import { createShuffleBag } from "./shuffle-bag";

describe("createShuffleBag — draw()", () => {
  it("returns undefined for an empty pool", () => {
    const bag = createShuffleBag(() => 0.5);
    expect(bag.draw([])).toBeUndefined();
  });

  it("always returns the only entry of a single-item pool", () => {
    const bag = createShuffleBag(() => 0.5);
    for (let i = 0; i < 5; i++) {
      expect(bag.draw(["only"])).toBe("only");
    }
  });

  it("an empty-pool draw does not disturb state for the next real draw", () => {
    const bag = createShuffleBag(() => 0.5);
    expect(bag.draw([])).toBeUndefined();
    expect(bag.draw(["only"])).toBe("only");
  });

  it("a 3-phrase pool drawn 6 times yields each phrase exactly twice, each half a full permutation, with no repeat across the halves' boundary", () => {
    // Real randomness: the invariant holds structurally for any rng in [0,1), not just a scripted one.
    const bag = createShuffleBag();
    const pool = ["alpha", "beta", "gamma"];
    const drawn = Array.from({ length: 6 }, () => bag.draw(pool));

    const firstHalf = drawn.slice(0, 3);
    const secondHalf = drawn.slice(3, 6);
    expect([...firstHalf].sort()).toEqual([...pool].sort());
    expect([...secondHalf].sort()).toEqual([...pool].sort());
    expect(drawn[2]).not.toBe(drawn[3]);

    const counts = new Map<string, number>();
    for (const phrase of drawn) counts.set(phrase!, (counts.get(phrase!) ?? 0) + 1);
    for (const phrase of pool) expect(counts.get(phrase)).toBe(2);
  });

  it("a changed pool refills instead of continuing to draw from the old one", () => {
    const bag = createShuffleBag();
    // Draw once from a 3-item pool without exhausting it.
    const first = bag.draw(["a", "b", "c"]);
    expect(["a", "b", "c"]).toContain(first);

    // Switch to a disjoint 2-item pool — every draw from here must come from the new pool,
    // and the bag must still behave like a fresh shuffle bag over it (no repeat until exhausted).
    const nextPool = ["x", "y"];
    const d1 = bag.draw(nextPool);
    const d2 = bag.draw(nextPool);
    expect(nextPool).toContain(d1);
    expect(nextPool).toContain(d2);
    expect(d1).not.toBe(d2);
  });

  it("avoids repeating the boundary phrase when a refill's naive first item matches the last draw", () => {
    // Scripted Fisher-Yates outcomes: cycle 1 shuffles to identity [a,b,c] (drawn a,b,c — last
    // drawn 'c'); cycle 2's naive shuffle would put 'c' first again, so the swap-avoidance rule
    // must move it later. See shuffle-bag.ts for the exact swap step this pins.
    const values = [0.9999, 0.9999, 0.0, 0.6, 0.0];
    let i = 0;
    const rng = () => values[i++]!;
    const bag = createShuffleBag(rng);
    const pool = ["a", "b", "c"];
    const drawn = [bag.draw(pool), bag.draw(pool), bag.draw(pool), bag.draw(pool)];

    expect(drawn.slice(0, 3)).toEqual(["a", "b", "c"]);
    expect(drawn[3]).not.toBe("c");
  });
});
