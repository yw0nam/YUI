/**
 * proactive-source.test.ts — idle-gap proactive firing source.
 *
 * Locks behavior over the shared `os_event` channel (bare `os_idle_tick`):
 *  - present (idle ≤ present_max) + gap ≥ cue.idle_min*60000 → fire, then re-fire every cue.idle_min.
 *  - away / null idle → ignore (presence alone does NOT reset the gap).
 *  - noteInteraction() resets the timer + clears the per-cue schedules.
 *  - multiple thresholds fire as the gap grows; overlapping cues push longest-idle_min first.
 *  - isEnabled()/per-cue enabled gate firing only.
 *  - off-Tauri degrade + start idempotency.
 */

import { describe, expect, it, vi } from "vitest";
import type { ProactiveCue } from "../io/proactive-settings";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createProactiveSource } from "./proactive-source";

function fakeBus(): { bus: Pick<EventBus, "push">; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  const bus: Pick<EventBus, "push"> = {
    push: vi.fn((e: BusEnvelope) => {
      pushed.push(e);
      return true;
    }),
  };
  return { bus, pushed };
}

function fakeListen(): {
  listen: OsEventListen;
  emit: (p: OsEventPayload) => void;
  unlisten: ReturnType<typeof vi.fn>;
} {
  let handler: ((e: { payload: OsEventPayload }) => void) | undefined;
  const unlisten = vi.fn();
  const listen: OsEventListen = vi.fn(async (_event, h) => {
    handler = h;
    return unlisten;
  });
  return {
    listen,
    emit: (payload) => handler?.({ payload }),
    unlisten,
  };
}

function idleTick(os_idle_ms: number | null, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

const PRESENT_MAX = 10_000;
const MIN = 60_000;

function cue(over: Partial<ProactiveCue> = {}): ProactiveCue {
  return {
    id: "mid_check",
    label: "슬슬 체크",
    context: "ctx",
    idle_min: 10,
    enabled: true,
    ...over,
  };
}

describe("proactive_source — re-fires every idle_min while present", () => {
  it("fires at the threshold, then again each period", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10 })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start(); // lastInteractionTs = 0

    // before threshold → no fire.
    t = 10 * MIN - 1;
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);

    // at threshold → fire.
    t = 10 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);

    // mid-period (one period not yet elapsed since last fire) → no-op.
    t = 15 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);

    // one full period after the first fire → re-fire.
    t = 20 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(2);

    // another period → re-fire again.
    t = 30 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(3);
  });
});

describe("proactive_source — gating", () => {
  it("skips when away (idle > present_max)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10 })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    t = 20 * MIN;
    emit(idleTick(PRESENT_MAX + 1));
    expect(pushed).toHaveLength(0);
  });

  it("skips when idle is null", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10 })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    t = 20 * MIN;
    emit(idleTick(null));
    expect(pushed).toHaveLength(0);
  });

  it("isEnabled() = false → no fire", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10 })],
      isEnabled: () => false,
      listen,
      now: () => t,
    });
    await src.start();
    t = 20 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });

  it("per-cue enabled:false → that cue does not fire", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10, enabled: false })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    t = 20 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });
});

describe("proactive_source — noteInteraction resets", () => {
  it("noteInteraction() resets timer + clears schedules → period restarts from new anchor", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10 })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    t = 10 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);

    // user interacts at t=10min → reset gap + clear latch.
    src.noteInteraction();

    t = 10 * MIN + (10 * MIN - 1);
    emit(idleTick(500));
    expect(pushed).toHaveLength(1); // not yet

    t = 10 * MIN + 10 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(2);
  });

  it("noteInteraction(ts) uses an explicit timestamp", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ idle_min: 10 })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    src.noteInteraction(5 * MIN);
    t = 15 * MIN - 1;
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);

    t = 15 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });
});

describe("proactive_source — multiple thresholds", () => {
  it("each threshold fires as its gap is reached", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const cues = [
      cue({ id: "short_break", idle_min: 5 }),
      cue({ id: "mid_check", idle_min: 10 }),
      cue({ id: "long_focus", idle_min: 30 }),
    ];
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => cues,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    // only short_break has reached its period.
    t = 5 * MIN;
    emit(idleTick(500));
    expect(pushed.map((e) => e.event_name)).toEqual(["proactive.short_break"]);

    // short_break re-fires (10min - 5min last fire = one period), mid_check first-fires.
    // longest idle_min within the same tick is pushed first.
    t = 10 * MIN;
    emit(idleTick(500));
    expect(pushed.map((e) => e.event_name)).toEqual([
      "proactive.short_break",
      "proactive.mid_check",
      "proactive.short_break",
    ]);
  });

  it("overlapping cues in one tick push longest idle_min first", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    // intentionally NOT in idle_min order — source must sort.
    const cues = [
      cue({ id: "short_break", idle_min: 5 }),
      cue({ id: "mid_check", idle_min: 10 }),
      cue({ id: "long_focus", idle_min: 30 }),
    ];
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => cues,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    // t=30min: all three have reached their period simultaneously (anchor = 0).
    t = 30 * MIN;
    emit(idleTick(500));
    expect(pushed.map((e) => e.event_name)).toEqual([
      "proactive.long_focus",
      "proactive.mid_check",
      "proactive.short_break",
    ]);
    // every envelope in the tick shares the single tickNow timestamp.
    expect(pushed.every((e) => e.ts === 30 * MIN)).toBe(true);
  });
});

describe("proactive_source — payload shape", () => {
  it("emits the timer_scheduler proactive.<id> envelope", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ id: "mid_check", label: "체크", context: "ctx", idle_min: 10 })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    t = 12 * MIN;
    emit(idleTick(500));

    const e = pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("proactive.mid_check");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.ts).toBe(t);
    expect(e.payload?.cue_id).toBe("mid_check");
    expect(e.payload?.label).toBe("체크");
    expect(e.payload?.context).toBe("ctx");
    expect(e.payload?.idle_min).toBe(10);
    expect(e.payload?.gap_ms).toBe(12 * MIN);
  });
});

describe("proactive_source — live getCues edits", () => {
  it("applies cues added after start at fire time", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const cues: ProactiveCue[] = [];
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => cues,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    t = 20 * MIN;
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);

    cues.push(cue({ id: "mid_check", idle_min: 10 }));
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("proactive.mid_check");
  });
});

describe("proactive_source — start idempotency", () => {
  it("subscribes once even when start() is called twice", async () => {
    const { bus } = fakeBus();
    const { listen } = fakeListen();
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => true,
      listen,
    });
    await src.start();
    await src.start();
    expect(listen).toHaveBeenCalledTimes(1);
  });
});

describe("proactive_source — off-Tauri degrade", () => {
  it("start() with no resolvable listen does not throw, stop() is safe", async () => {
    const { bus, pushed } = fakeBus();
    const src = createProactiveSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => true,
      listen: undefined,
    });
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
    expect(pushed).toHaveLength(0);
  });
});
