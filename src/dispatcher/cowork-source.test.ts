/**
 * cowork-source.test.ts — co-working presence+cadence firing source (#24 Step 6).
 *
 * Locks the state machine over the shared `os_event` channel (bare `os_idle_tick`):
 *  - null idle → ignore (no fire, no presence mutation).
 *  - away→present edge re-anchors (no fire that tick).
 *  - cadence: fire once at/after interval_ms while held present, repeating.
 *  - isEnabled() gates firing only — state persists across toggles.
 *  - off-Tauri degrade: start() no-throw, stop() safe.
 *  - non-idle os_event ignored.
 */

import { describe, expect, it, vi } from "vitest";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { createCoworkSource } from "./cowork-source";
import type { BusEnvelope, EventBus } from "./event-bus";

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

/** A fake listen that captures the channel handler so tests can feed payloads. */
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

const COWORK = { interval_ms: 30_000, present_max_idle_ms: 10_000 };

describe("cowork_source — null-tick-no-mutation", () => {
  it("ignores null idle (no push) and treats next present tick as a fresh away→present", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 1_000;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    // null → ignored entirely.
    emit(idleTick(null));
    expect(pushed).toHaveLength(0);

    // First present tick after null re-anchors (no fire).
    emit(idleTick(500));
    expect(pushed).toHaveLength(0);

    // Even far past interval, the re-anchor means no immediate fire.
    t += COWORK.interval_ms + 1;
    emit(idleTick(500));
    expect(pushed).toHaveLength(1);
  });
});

describe("cowork_source — first-fire-after-interval", () => {
  it("does not fire before interval and fires exactly once at/after interval", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    // away→present edge: re-anchors at t=0, no fire.
    emit(idleTick(100));
    expect(pushed).toHaveLength(0);

    // before interval → no fire.
    t = COWORK.interval_ms - 1;
    emit(idleTick(100));
    expect(pushed).toHaveLength(0);

    // at interval → fire once.
    t = COWORK.interval_ms;
    emit(idleTick(200));
    expect(pushed).toHaveLength(1);

    const e = pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("proactive.cowork");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.payload?.os_idle_ms).toBe(200);
    expect(e.ts).toBe(t);
  });
});

describe("cowork_source — re-anchor-no-fire-on-return", () => {
  it("re-anchors on return from away and does not fire even after a long gap", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    // present edge then go away.
    emit(idleTick(100));
    t = 5_000;
    emit(idleTick(COWORK.present_max_idle_ms + 1)); // away

    // long gap, then present again.
    t = 10_000_000;
    emit(idleTick(100)); // away→present edge → re-anchor, no fire
    expect(pushed).toHaveLength(0);

    // only after a fresh interval from the re-anchor does it fire.
    t += COWORK.interval_ms;
    emit(idleTick(100));
    expect(pushed).toHaveLength(1);
  });
});

describe("cowork_source — no-fire-while-away", () => {
  it("never fires while idle exceeds present_max", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    for (let i = 0; i < 5; i++) {
      t += COWORK.interval_ms;
      emit(idleTick(COWORK.present_max_idle_ms + 1));
    }
    expect(pushed).toHaveLength(0);
  });
});

describe("cowork_source — double-fire-while-held", () => {
  it("fires again only after another interval elapses while held present", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    // re-anchor edge.
    emit(idleTick(100));

    // first fire at interval.
    t = COWORK.interval_ms;
    emit(idleTick(100));
    expect(pushed).toHaveLength(1);

    // before next interval → no 2nd fire.
    t = COWORK.interval_ms + (COWORK.interval_ms - 1);
    emit(idleTick(100));
    expect(pushed).toHaveLength(1);

    // after next interval → 2nd fire.
    t = COWORK.interval_ms * 2;
    emit(idleTick(100));
    expect(pushed).toHaveLength(2);
  });
});

describe("cowork_source — toggle-off persists state", () => {
  it("does not fire while disabled and fires once (no catch-up burst) when re-enabled", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    let enabled = false;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => enabled,
      listen,
      now: () => t,
    });
    await src.start();

    // re-anchor edge (disabled — but edge still re-anchors).
    emit(idleTick(100));

    // interval elapsed but disabled → no fire, lastFireTs not advanced.
    t = COWORK.interval_ms;
    emit(idleTick(100));
    expect(pushed).toHaveLength(0);

    // many intervals later, still disabled.
    t = COWORK.interval_ms * 5;
    emit(idleTick(100));
    expect(pushed).toHaveLength(0);

    // re-enable: now-lastFireTs ≥ interval → single fire (not a burst).
    enabled = true;
    t = COWORK.interval_ms * 6;
    emit(idleTick(100));
    expect(pushed).toHaveLength(1);
  });
});

describe("cowork_source — off-Tauri degrade", () => {
  it("start() with no resolvable listen does not throw, stop() is safe", async () => {
    const { bus, pushed } = fakeBus();
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen: undefined,
    });
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
    expect(pushed).toHaveLength(0);
  });
});

describe("cowork_source — non-idle event ignored", () => {
  it("ignores active_app_changed / fullscreen events with no push or state change", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit } = fakeListen();
    let t = 0;
    const src = createCoworkSource({
      bus,
      cowork: COWORK,
      isEnabled: () => true,
      listen,
      now: () => t,
    });
    await src.start();

    emit({ event_name: "active_app_changed", ts: 0, data: { active_app_name: "Code" } });
    emit({ event_name: "fullscreen_entered", ts: 0, data: { is_fullscreen: true } });
    expect(pushed).toHaveLength(0);

    // state untouched: first real present tick still acts as a fresh re-anchor.
    emit(idleTick(100));
    t = COWORK.interval_ms;
    emit(idleTick(100));
    expect(pushed).toHaveLength(1);
  });
});

describe("cowork_source — start idempotency", () => {
  it("subscribes once even when start() is called twice", async () => {
    const { bus } = fakeBus();
    const { listen } = fakeListen();
    const src = createCoworkSource({ bus, cowork: COWORK, isEnabled: () => true, listen });
    await src.start();
    await src.start();
    expect(listen).toHaveBeenCalledTimes(1);
  });
});
