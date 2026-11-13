/** reaction-thresholds.test.ts — the waiting-count edge and the per-Thread long wait that start a Thread reaction without a chip tap. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Thread } from "../../contract";
import { createReactionThresholds, type ThresholdReach } from "./reaction-thresholds";

const waiting = (id: string): Thread => ({
  id,
  source: "codex",
  title: "Build",
  state: "input-required",
  entries: [],
  created_at: 1,
  updated_at: 1,
  entry_count: 0,
});

function setup(deps?: { count?: number; waitMs?: number }) {
  const reach: ThresholdReach[] = [];
  let now = 0;
  const thresholds = createReactionThresholds({
    count: () => deps?.count ?? 3,
    waitMs: () => deps?.waitMs ?? 600_000,
    now: () => now,
    onReach: (cause) => reach.push(cause),
  });
  return {
    reach,
    thresholds,
    advance(ms: number) {
      now += ms;
      return vi.advanceTimersByTimeAsync(ms);
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const counts = (reach: ThresholdReach[]) => reach.filter((r) => r.cause === "count");

it("the baseline reaches nothing but still starts baseline waits, and the count edge re-arms below N", async () => {
  const h = setup();
  h.thresholds.next([waiting("t1"), waiting("t2"), waiting("t3")]);
  expect(h.reach).toEqual([]);

  await h.advance(600_000);
  expect(h.reach).toEqual([
    { cause: "wait", threadId: "t1" },
    { cause: "wait", threadId: "t2" },
    { cause: "wait", threadId: "t3" },
  ]);

  h.thresholds.next([waiting("t1"), waiting("t2")]);
  h.thresholds.next([waiting("t1"), waiting("t2"), waiting("t4")]);
  expect(counts(h.reach)).toEqual([{ cause: "count" }]);

  h.thresholds.next([waiting("t1"), waiting("t2"), waiting("t4"), waiting("t5")]);
  expect(counts(h.reach)).toEqual([{ cause: "count" }]);

  h.thresholds.next([waiting("t1"), waiting("t2")]);
  h.thresholds.next([waiting("t1"), waiting("t2"), waiting("t4")]);
  expect(counts(h.reach)).toEqual([{ cause: "count" }, { cause: "count" }]);
});

it("a Thread reaches its wait once, ten minutes after it was first counted, and a Thread that left never does", async () => {
  const h = setup({ count: 0 });
  h.thresholds.next([waiting("a"), waiting("b")]);
  h.thresholds.next([waiting("a")]);

  await h.advance(600_000);
  expect(h.reach).toEqual([{ cause: "wait", threadId: "a" }]);

  await h.advance(600_000);
  expect(h.reach).toEqual([{ cause: "wait", threadId: "a" }]);

  h.thresholds.next([waiting("a"), waiting("c")]);
  await h.advance(600_000);
  expect(h.reach).toEqual([
    { cause: "wait", threadId: "a" },
    { cause: "wait", threadId: "c" },
  ]);
});

it("nothing reaches while both thresholds are off; a counted Thread reaches its wait once T is on", async () => {
  let waitMs = 0;
  const reach: ThresholdReach[] = [];
  let now = 0;
  const thresholds = createReactionThresholds({
    count: () => 0,
    waitMs: () => waitMs,
    now: () => now,
    onReach: (cause) => reach.push(cause),
  });
  const advance = async (ms: number) => {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };

  thresholds.next([waiting("t1")]);
  await advance(3_600_000);
  expect(reach).toEqual([]);

  waitMs = 600_000;
  thresholds.next([waiting("t1")]);
  await advance(600_000);
  expect(reach).toEqual([{ cause: "wait", threadId: "t1" }]);
});
