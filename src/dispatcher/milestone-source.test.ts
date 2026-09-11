/**
 * milestone-source.test.ts — once-per-day client clock facts.
 *
 * Locks behavior over the shared `os_event` channel (bare `os_idle_tick`):
 *  - first present tick of the local day → one `time_milestone.first_activity` envelope.
 *  - later ticks the same day → nothing, and the signal buffers stay untouched.
 *  - persisted day latch survives a restart; a crossed midnight re-arms the milestone.
 *  - away / null idle / isEnabled() false → no fire and no drain.
 *  - off-Tauri degrade + start idempotency.
 */

import { describe, expect, it, vi } from "vitest";
import type { SignalGroup } from "../contract";
import type { PersistedStorage } from "../io/persisted-store";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createMilestoneSource } from "./milestone-source";

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

function idleTick(os_idle_ms: number | null | undefined, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

function fakeFiredStorage(initial: Record<string, string> = {}): {
  storage: PersistedStorage<Record<string, string>>;
  save: ReturnType<typeof vi.fn>;
} {
  let fired = { ...initial };
  const save = vi.fn((next: Record<string, string>) => {
    fired = { ...next };
  });
  return { storage: { load: () => ({ ...fired }), save }, save };
}

const PRESENT_MAX = 10_000;

/** epoch ms for a given local date/time. */
function at(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo, d, h, mi, 0, 0).getTime();
}

function group(id: string): SignalGroup {
  return {
    envelope: {
      source: "n8n",
      event_type: "daily_briefing",
      delivery: "batched",
      event_id: id,
      occurred_at: 1_787_449_000_000,
    },
    items: [{ skill: "yui-daily-briefing" }],
  };
}

describe("milestone_source — first present tick of the day", () => {
  it("pushes one time_milestone.first_activity envelope carrying the drained groups", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const { storage, save } = fakeFiredStorage();
    const groups = [group("daily-briefing:2026-09-11")];
    const drainSignals = vi.fn(() => groups);
    const t = at(2026, 5, 15, 8, 12);
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals,
      firedStorage: storage,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));

    expect(pushed).toEqual([
      {
        source: "timer_scheduler",
        event_name: "time_milestone.first_activity",
        ts: t,
        hint_tier: 2,
        dnd_override: false,
        payload: {
          name: "first_activity",
          local_time: "08:12",
          signals: groups,
        },
      },
    ]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ first_activity: "2026-5-15" });
  });
});

describe("milestone_source — once-per-day latch", () => {
  it("a second present tick the same day fires nothing and drains nothing", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const { storage } = fakeFiredStorage();
    const drainSignals = vi.fn(() => []);
    let t = at(2026, 5, 15, 8, 12);
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals,
      firedStorage: storage,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));
    t = at(2026, 5, 15, 9, 30);
    emit(idleTick(500));

    expect(pushed).toHaveLength(1);
    expect(drainSignals).toHaveBeenCalledTimes(1);
  });

  it("a same-day restart reads the persisted latch and stays silent", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const { storage } = fakeFiredStorage({ first_activity: "2026-5-15" });
    const drainSignals = vi.fn(() => []);
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals,
      firedStorage: storage,
      listen,
      now: () => at(2026, 5, 15, 8, 12),
    });
    await src.start();

    emit(idleTick(500));

    expect(pushed).toHaveLength(0);
    expect(drainSignals).not.toHaveBeenCalled();
  });

  it("one instance running across midnight fires again on the first present tick after it", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const { storage } = fakeFiredStorage();
    let t = at(2026, 5, 15, 23, 50);
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals: () => [],
      firedStorage: storage,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));
    expect(pushed).toHaveLength(1);

    t = at(2026, 5, 16, 0, 5);
    emit(idleTick(500));

    expect(pushed).toHaveLength(2);
    expect(pushed[1].payload?.local_time).toBe("00:05");
  });
});

describe("milestone_source — presence gate", () => {
  const cases: Array<[string, number | null | undefined, number]> = [
    ["idle exactly at the threshold", PRESENT_MAX, 1],
    ["idle one millisecond above the threshold", PRESENT_MAX + 1, 0],
    ["null idle", null, 0],
    ["undefined idle", undefined, 0],
  ];

  it.each(cases)("%s → %i push", async (_name, idle, expected) => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const { storage } = fakeFiredStorage();
    const drainSignals = vi.fn(() => []);
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals,
      firedStorage: storage,
      listen,
      now: () => at(2026, 5, 15, 8, 12),
    });
    await src.start();

    emit(idleTick(idle));

    expect(pushed).toHaveLength(expected);
    expect(drainSignals).toHaveBeenCalledTimes(expected);
  });
});

describe("milestone_source — enable gate", () => {
  it("isEnabled() false → no fire, no drain, no persist", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const { storage, save } = fakeFiredStorage();
    const drainSignals = vi.fn(() => []);
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => false,
      drainSignals,
      firedStorage: storage,
      listen,
      now: () => at(2026, 5, 15, 8, 12),
    });
    await src.start();

    emit(idleTick(500));

    expect(pushed).toHaveLength(0);
    expect(drainSignals).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("milestone_source — lifecycle", () => {
  it("start() with no resolvable listen does not throw, stop() is safe", async () => {
    const { bus, pushed } = fakeBus();
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals: () => [],
      firedStorage: fakeFiredStorage().storage,
      listen: undefined,
    });

    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
    expect(pushed).toHaveLength(0);
  });

  it("subscribes once even when start() is called twice, and stop() unlistens", async () => {
    const { bus } = fakeBus();
    const { listen, unlisten } = fakeListen();
    const src = createMilestoneSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      drainSignals: () => [],
      firedStorage: fakeFiredStorage().storage,
      listen,
    });

    await src.start();
    await src.start();
    expect(listen).toHaveBeenCalledTimes(1);

    src.stop();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
