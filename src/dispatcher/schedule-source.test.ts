/**
 * schedule-source.test.ts — clock-time schedule firing source.
 *
 * Locks behavior over the shared `os_event` channel (bare `os_idle_tick`):
 *  - present (idle ≤ present_max) + within 2h after cue.time → fire once/day per cue.
 *  - away / null idle → ignore.
 *  - not-yet-due cue → no fire.
 *  - persisted day latch survives source restarts.
 *  - isEnabled()/per-cue enabled gate firing only.
 *  - off-Tauri degrade + start idempotency.
 */

import { describe, expect, it, vi } from "vitest";
import type { PersistedStorage } from "../io/persisted-store";
import type { ScheduledCue } from "../io/schedule-settings";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createScheduleSource } from "./schedule-source";

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

function fakeFiredStorage(): PersistedStorage<Record<string, string>> {
  let fired: Record<string, string> = {};
  return {
    load: () => ({ ...fired }),
    save: (next) => {
      fired = { ...next };
    },
  };
}

const PRESENT_MAX = 10_000;

function cue(over: Partial<ScheduledCue> = {}): ScheduledCue {
  return {
    id: "morning",
    label: "아침",
    context: "ctx",
    time: "09:00",
    enabled: true,
    ...over,
  };
}

/** epoch ms for a given local date/time. */
function at(y: number, mo: number, d: number, h: number, mi: number): number {
  return new Date(y, mo, d, h, mi, 0, 0).getTime();
}

describe("schedule_source — fires due cue once when present", () => {
  it("fires when present and currentHHMM ≥ cue.time", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 9, 30);
    const cues = [cue()];
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => cues,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });
});

describe("schedule_source — gating", () => {
  it("skips when away (idle > present_max)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(PRESENT_MAX + 1));
    expect(pushed).toHaveLength(0);
  });

  it("skips when idle is null", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(null));
    expect(pushed).toHaveLength(0);
  });

  it("not-yet-due cue does not fire (currentHHMM < cue.time)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 8, 59);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ time: "09:00" })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });

  it("isEnabled() = false → no fire", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => false,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });

  it("per-cue enabled:false → that cue does not fire", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ enabled: false })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });
});

describe("schedule_source — once-per-day latch", () => {
  it("fires each cue only once per day", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));
    t = at(2026, 5, 15, 10, 0);
    emit(idleTick(500));
    t = at(2026, 5, 15, 23, 0);
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });

  it("day-boundary reset re-fires next day", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue()],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));
    expect(pushed).toHaveLength(1);

    // next day, same time
    t = at(2026, 5, 16, 9, 30);
    emit(idleTick(500));
    expect(pushed).toHaveLength(2);
  });

  it("latch survives a restart — two source lifetimes on the same day fire once total", async () => {
    const { bus, pushed } = fakeBus();
    const sourceAListen = fakeListen();
    const sourceBListen = fakeListen();
    const firedStorage = fakeFiredStorage();
    const t = at(2026, 5, 15, 9, 30);
    const deps = {
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ time: "09:00" })],
      isEnabled: () => true,
      now: () => t,
      firedStorage,
    };
    const sourceA = createScheduleSource({ ...deps, listen: sourceAListen.listen });
    await sourceA.start();
    sourceAListen.emit(idleTick(500));
    expect(pushed).toHaveLength(1);
    sourceA.stop();

    const sourceB = createScheduleSource({ ...deps, listen: sourceBListen.listen });
    await sourceB.start();
    sourceBListen.emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });
});

describe("schedule_source — startup catch-up", () => {
  it("a cue more than the grace window past its time does not fire", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 14, 0);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ time: "09:00" })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });

  it("fires a cue within the grace window", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 10, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ time: "09:00" })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });

  it("fires a cue exactly 120 minutes after its time", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 11, 0);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ time: "09:00" })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });

  it("does not fire a cue 121 minutes after its time", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 11, 1);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ time: "09:00" })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);
  });
});

describe("schedule_source — payload shape", () => {
  it("emits the timer_scheduler schedule.<id> envelope", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 9, 30);
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => [cue({ id: "lunch", label: "점심", context: "밥", time: "09:00" })],
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();
    emit(idleTick(500));

    const e = pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("schedule.lunch");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.ts).toBe(t);
    expect(e.payload?.cue_id).toBe("lunch");
    expect(e.payload?.label).toBe("점심");
    expect(e.payload?.context).toBe("밥");
    expect(e.payload?.local_time).toBe("09:30");
  });
});

describe("schedule_source — live getCues edits", () => {
  it("applies cues added after start at fire time", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    const t = at(2026, 5, 15, 12, 30);
    const cues: ScheduledCue[] = [];
    const src = createScheduleSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      getCues: () => cues,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    emit(idleTick(500));
    expect(pushed).toHaveLength(0);

    cues.push(cue({ id: "lunch", time: "12:00" }));
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("schedule.lunch");
  });
});

describe("schedule_source — start idempotency", () => {
  it("subscribes once even when start() is called twice", async () => {
    const { bus } = fakeBus();
    const { listen } = fakeListen();
    const src = createScheduleSource({
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

describe("schedule_source — off-Tauri degrade", () => {
  it("start() with no resolvable listen does not throw, stop() is safe", async () => {
    const { bus, pushed } = fakeBus();
    const src = createScheduleSource({
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
