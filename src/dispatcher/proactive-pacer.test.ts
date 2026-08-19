/**
 * proactive-pacer.test.ts — the global quiet gap every proactive fire waits out after a turn start.
 *
 * Locks:
 *  - nothing is held before the first turn start;
 *  - the window holds from the anchor until the interval elapses, and a later turn re-anchors it;
 *  - interval 0 disables the pacer entirely (no hold, no timer);
 *  - subscribers see true at the anchor and false at the window-open edge, and stop after
 *    unsubscribe / stop().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProactivePacer } from "./proactive-pacer";

const GAP = 600_000;

/** Pacer over a controllable clock; `advance` moves the clock and the open timer together. */
function setup(intervalMs = GAP) {
  let interval = intervalMs;
  let t = 0;
  const pacer = createProactivePacer({ getIntervalMs: () => interval, now: () => t });
  return {
    pacer,
    setInterval(ms: number) {
      interval = ms;
    },
    advance(ms: number) {
      t += ms;
      vi.advanceTimersByTime(ms);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("proactive_pacer — hold window", () => {
  it("holds nothing before the first turn start", () => {
    const s = setup();
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });

  it("holds from the turn start until the interval elapses", () => {
    const s = setup();
    s.pacer.noteTurnStart();
    expect(s.pacer.isHolding()).toBe(true);

    s.advance(GAP - 1);
    expect(s.pacer.isHolding()).toBe(true);

    s.advance(1);
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });

  it("re-anchors on the next turn start, extending the window", () => {
    const s = setup();
    s.pacer.noteTurnStart();
    s.advance(GAP / 2);
    s.pacer.noteTurnStart();

    // The original expiry passes with the window still held.
    s.advance(GAP / 2);
    expect(s.pacer.isHolding()).toBe(true);

    s.advance(GAP / 2);
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });

  it("never holds when the interval is 0, and schedules no timer", () => {
    const s = setup(0);
    s.pacer.noteTurnStart();

    expect(s.pacer.isHolding()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    s.pacer.stop();
  });

  it("stops holding as soon as the interval is turned down below the elapsed gap", () => {
    const s = setup();
    s.pacer.noteTurnStart();
    s.advance(60_000);
    expect(s.pacer.isHolding()).toBe(true);

    s.setInterval(30_000);
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });

  // The open timer is armed from the interval that was current at the anchor; a raise makes
  // that timer early, so it must re-check the window instead of assuming it is the edge.
  it("holds to the new expiry when the interval is raised mid-hold", () => {
    const s = setup();
    s.pacer.noteTurnStart();
    s.advance(GAP / 2);
    s.setInterval(GAP * 2);

    s.advance(GAP); // past the original expiry
    expect(s.pacer.isHolding()).toBe(true);

    s.advance(GAP / 2); // now past the new one
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });
});

describe("proactive_pacer — interval edits", () => {
  it("re-arms the open edge at the new expiry when the interval is raised mid-hold", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    s.advance(GAP / 2);
    s.setInterval(GAP * 2);
    s.pacer.noteIntervalChanged();

    s.advance(GAP);
    expect(holds).toEqual([true]);

    s.advance(GAP / 2);
    expect(holds).toEqual([true, false]);
    s.pacer.stop();
  });

  // Without this, the buffered inboxes stay held on a stale window while the skipping sources
  // are already free — isHolding() flips but no one is told.
  it("opens the window at once when the interval drops below the elapsed hold", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    s.advance(60_000);
    s.setInterval(30_000);
    s.pacer.noteIntervalChanged();

    expect(holds).toEqual([true, false]);
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });

  it("opens the window at once when the pacer is turned off mid-hold", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    s.advance(60_000);
    s.setInterval(0);
    s.pacer.noteIntervalChanged();

    expect(holds).toEqual([true, false]);
    expect(s.pacer.isHolding()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    s.pacer.stop();
  });

  it("notifies nothing on an interval edit that leaves the window still holding", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    s.advance(60_000);
    s.setInterval(GAP / 2);
    s.pacer.noteIntervalChanged();

    expect(holds).toEqual([true]);
    expect(s.pacer.isHolding()).toBe(true);
    s.pacer.stop();
  });

  it("stays quiet on an interval edit while no window is open", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.setInterval(GAP * 2);
    s.pacer.noteIntervalChanged();

    expect(holds).toEqual([]);
    expect(s.pacer.isHolding()).toBe(false);
    s.pacer.stop();
  });
});

describe("proactive_pacer — subscribers", () => {
  it("notifies true at the anchor and false when the window opens", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    expect(holds).toEqual([true]);

    s.advance(GAP);
    expect(holds).toEqual([true, false]);
    s.pacer.stop();
  });

  it("moves the open edge to the extended expiry after a re-anchor", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    s.advance(GAP / 2);
    s.pacer.noteTurnStart();
    s.advance(GAP / 2);
    expect(holds).toEqual([true, true]);

    s.advance(GAP / 2);
    expect(holds).toEqual([true, true, false]);
    s.pacer.stop();
  });

  it("stops notifying an unsubscribed listener", () => {
    const s = setup();
    const holds: boolean[] = [];
    const unsubscribe = s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    unsubscribe();
    s.advance(GAP);

    expect(holds).toEqual([true]);
    s.pacer.stop();
  });

  it("stop() drops the pending open timer and every subscriber", () => {
    const s = setup();
    const holds: boolean[] = [];
    s.pacer.subscribe((holding) => holds.push(holding));

    s.pacer.noteTurnStart();
    s.pacer.stop();

    expect(vi.getTimerCount()).toBe(0);
    s.advance(GAP);
    expect(holds).toEqual([true]);
  });
});
