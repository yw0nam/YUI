/**
 * drag-hold-source.test.ts — drag-held-past-threshold reflex candidate.
 *
 * Client-firing, backend-judged: a drag held past holdMs pushes ONE tier2
 * proactive.drag_held candidate; the backend decides whether/what to say.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { BusEnvelope, EventBus } from "../dispatcher/event-bus";
import { createDragHoldSource } from "./drag-hold-source";

/** Minimal in-memory bus capturing pushes. */
function makeBus(): { bus: EventBus; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: EventBus = {
    push(env) {
      pushed.push(env);
      return true;
    },
    pop() {
      return null;
    },
    snapshot() {
      return [...pushed];
    },
  };
  return { bus, pushed };
}

/** id-keyed fake timer — lets a test prove a superseded timer never fires. */
function makeFakeTimers() {
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const fakeSetTimeout = ((cb: () => void) => {
    const id = nextId++;
    timers.set(id, cb);
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  const fakeClearTimeout = ((id?: ReturnType<typeof setTimeout>) => {
    if (id !== undefined) timers.delete(id as unknown as number);
  }) as typeof clearTimeout;
  function fireLatest(): void {
    const id = [...timers.keys()].at(-1);
    if (id === undefined) return;
    const cb = timers.get(id)!;
    timers.delete(id);
    cb();
  }
  function pendingCount(): number {
    return timers.size;
  }
  return { fakeSetTimeout, fakeClearTimeout, fireLatest, pendingCount };
}

const CUE = { label: "dragged around", context: "put me down" };

let bus: EventBus;
let pushed: BusEnvelope[];

beforeEach(() => {
  ({ bus, pushed } = makeBus());
});

describe("drag-hold-source", () => {
  it("fires proactive.drag_held once after holdMs while still dragging", () => {
    const timers = makeFakeTimers();
    const source = createDragHoldSource({
      bus,
      holdMs: 5000,
      getCue: () => CUE,
      now: () => 1_000,
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });

    source.noteDragStart();
    timers.fireLatest();

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatchObject({
      source: "os_event_watcher",
      event_name: "proactive.drag_held",
      ts: 1_000,
      hint_tier: 2,
      payload: { cue_id: "drag_held", label: CUE.label, context: CUE.context },
    });
  });

  it("noteDragEnd cancels a pending timer — no fire", () => {
    const timers = makeFakeTimers();
    const source = createDragHoldSource({
      bus,
      holdMs: 5000,
      getCue: () => CUE,
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });

    source.noteDragStart();
    source.noteDragEnd();
    expect(timers.pendingCount()).toBe(0);
    timers.fireLatest();

    expect(pushed).toHaveLength(0);
  });

  it("a second noteDragStart re-arms — the superseded timer never fires", () => {
    const timers = makeFakeTimers();
    const source = createDragHoldSource({
      bus,
      holdMs: 5000,
      getCue: () => CUE,
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });

    source.noteDragStart();
    source.noteDragStart();
    expect(timers.pendingCount()).toBe(1);
    timers.fireLatest();

    expect(pushed).toHaveLength(1);
  });

  it("does not double-fire without an intervening noteDragStart", () => {
    const timers = makeFakeTimers();
    const source = createDragHoldSource({
      bus,
      holdMs: 5000,
      getCue: () => CUE,
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });

    source.noteDragStart();
    timers.fireLatest();
    expect(pushed).toHaveLength(1);

    // No new noteDragStart → nothing pending to re-fire.
    expect(timers.pendingCount()).toBe(0);
    timers.fireLatest();
    expect(pushed).toHaveLength(1);
  });

  it("noteDragEnd after a fire is a no-op (already disarmed)", () => {
    const timers = makeFakeTimers();
    const source = createDragHoldSource({
      bus,
      holdMs: 5000,
      getCue: () => CUE,
      setTimeout: timers.fakeSetTimeout,
      clearTimeout: timers.fakeClearTimeout,
    });

    source.noteDragStart();
    timers.fireLatest();
    expect(() => source.noteDragEnd()).not.toThrow();
    expect(pushed).toHaveLength(1);
  });
});
