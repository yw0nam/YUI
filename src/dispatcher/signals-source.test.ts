/**
 * signals-source.test.ts — grouped signal delivery and buffering.
 *
 * Covers legacy and enveloped groups, immediate and batched routing, independent
 * drop-oldest buffers, arrival-ordered catch-up and drain, lazy timer behavior,
 * envelope downgrade, and enable/presence/busy/lifecycle transitions. Signal item
 * contents remain opaque. All dependencies are injected; tests use no network or Tauri.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composePacedPipelineBusy } from "../bootstrap-wiring";
import type { SignalsBatch } from "../io/signals-inbox";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createSignalsSource } from "./signals-source";

const PRESENT_MAX = 10_000;
const LOW_IDLE = 500; // present
const HIGH_IDLE = PRESENT_MAX + 1; // away

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

function fakeListen(): { listen: OsEventListen; emit: (p: OsEventPayload) => void } {
  let handler: ((e: { payload: OsEventPayload }) => void) | undefined;
  const listen: OsEventListen = vi.fn(async (_event, h) => {
    handler = h;
    return vi.fn();
  });
  return { listen, emit: (payload) => handler?.({ payload }) };
}

type OnInboxFn = (cb: (p: SignalsBatch) => void, deps?: { listen?: OsEventListen }) => () => void;

function fakeInbox(): { onInbox: OnInboxFn; emit: (p: SignalsBatch) => void } {
  let handler: ((p: SignalsBatch) => void) | undefined;
  const onInbox: OnInboxFn = vi.fn((cb) => {
    handler = cb;
    return vi.fn();
  });
  return { onInbox, emit: (p) => handler?.(p) };
}

function idleTick(os_idle_ms: number | null, ts = 0): OsEventPayload {
  return { event_name: "os_idle_tick", ts, data: { os_idle_ms } };
}

const ENVELOPE = {
  source: "n8n",
  event_type: "workflow_done",
  delivery: "immediate" as const,
  event_id: "run-8812",
  occurred_at: 1_787_449_000_000,
};

function batch(items: Array<Record<string, unknown>>, ts = 1000, envelope?: unknown): SignalsBatch {
  return { signals: items, ts, ...(envelope !== undefined ? { envelope } : {}) } as SignalsBatch;
}

describe("signals_source — present: immediate signals.push (spec §1)", () => {
  it("inbox arrival while present → pushes signals.push with signals verbatim", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const now = vi.fn(() => 9000);

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      now,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(batch([{ kind: "reminder", foo: "bar" }], 8500));

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.source).toBe("timer_scheduler");
    expect(e.event_name).toBe("signals.push");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    expect(e.payload).toEqual({ signals: [{ items: [{ kind: "reminder", foo: "bar" }] }] });

    src.stop();
  });

  it("does not inspect or reshape item contents — heterogeneous items pass through as-is (spec §9)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    const weird = [{ a: 1 }, { nested: { b: [1, 2, 3] } }, { c: null }];
    emitInbox(batch(weird, 1));

    expect((pushed[0].payload as { signals: unknown[] }).signals).toEqual([{ items: weird }]);

    src.stop();
  });
});

describe("signals_source — away: buffer + catch-up (spec §2–3)", () => {
  it("drain returns buffered items in arrival order, clears them, and prevents catch-up on return", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }]));
    emitInbox(batch([{ id: 2 }, { id: 3 }]));

    expect(src.drain()).toEqual([{ items: [{ id: 1 }] }, { items: [{ id: 2 }, { id: 3 }] }]);
    expect(src.drain()).toEqual([]);
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toEqual([]);

    src.stop();
  });

  it("away: inbox arrivals are buffered (nothing pushed); present tick → ONE signals.catchup; buffer cleared", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    // Away — two batches.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }], 1000));
    emitInbox(batch([{ id: 2 }, { id: 3 }], 2000));
    expect(pushed).toHaveLength(0);

    // Present tick → catch-up.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.event_name).toBe("signals.catchup");
    expect(e.source).toBe("timer_scheduler");
    expect(e.hint_tier).toBe(2);
    expect(e.dnd_override).toBe(false);
    const p = e.payload as { signals: unknown[] };
    expect(p.signals).toEqual([{ items: [{ id: 1 }] }, { items: [{ id: 2 }, { id: 3 }] }]);

    // Buffer cleared — another present tick emits nothing further.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);

    src.stop();
  });

  it("present→present ticks do NOT re-fire an already-cleared buffer (spec §4)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }]));
    emitIdle(idleTick(LOW_IDLE)); // flush
    const countAfterFlush = pushed.length;
    emitIdle(idleTick(LOW_IDLE)); // second present tick — nothing buffered
    emitIdle(idleTick(LOW_IDLE)); // third
    expect(pushed).toHaveLength(countAfterFlush);

    src.stop();
  });
});

describe("signals_source — buffer cap 5 batches (spec §5)", () => {
  it("keeps only the last 5 buffered batches (drops oldest)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(HIGH_IDLE));
    // 7 single-item batches, ids 1..7.
    for (let i = 1; i <= 7; i++) {
      emitInbox(batch([{ id: i }], i * 10));
    }
    expect(pushed).toHaveLength(0);

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { signals: Array<{ items: Array<{ id: number }> }> };
    expect(p.signals.map((group) => group.items[0].id)).toEqual([3, 4, 5, 6, 7]);

    src.stop();
  });
});

describe("signals_source — isEnabled gate (spec §6)", () => {
  it("!isEnabled() → inbox arrival is dropped without buffering", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => false,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(batch([{ id: 1 }]));
    expect(pushed).toHaveLength(0);

    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(0);

    src.stop();
  });

  it("mid-away disable drops the stale buffer, so a later re-enable+return only surfaces new items", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    let enabled = true;

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => enabled,
      onInbox,
      listen,
    });
    await src.start();

    // Away — two batches buffered while enabled.
    emitIdle(idleTick(HIGH_IDLE));
    emitInbox(batch([{ id: 1 }], 1000));
    emitInbox(batch([{ id: 2 }], 2000));
    expect(pushed).toHaveLength(0);

    // Disable mid-away.
    enabled = false;
    emitIdle(idleTick(HIGH_IDLE));

    // Re-enable while still away, then a new batch arrives.
    enabled = true;
    emitInbox(batch([{ id: 3 }], 3000));

    // Return to present — exactly ONE catchup, containing only the new item.
    emitIdle(idleTick(LOW_IDLE));
    expect(pushed).toHaveLength(1);
    const p = pushed[0].payload as { signals: Array<{ items: Array<{ id: number }> }> };
    expect(p.signals[0]).toEqual({ items: [{ id: 3 }] });

    src.stop();
  });
});

function fakePipelineBusy(initialBusy: boolean): {
  isPipelineBusy: () => boolean;
  subscribePipelineBusy: (cb: (busy: boolean) => void) => () => void;
  setBusy: (busy: boolean) => void;
} {
  let current = initialBusy;
  let cb: ((busy: boolean) => void) | undefined;
  return {
    isPipelineBusy: () => current,
    subscribePipelineBusy: vi.fn((c: (busy: boolean) => void) => {
      cb = c;
      return vi.fn();
    }),
    setBusy: (busy: boolean) => {
      current = busy;
      cb?.(busy);
    },
  };
}

describe("signals_source — pipeline-busy buffering (spec §2b/#451)", () => {
  it("present + busy: inbox arrival buffers (no signals.push fired)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const pipelineBusy = fakePipelineBusy(true);

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: pipelineBusy.isPipelineBusy,
      subscribePipelineBusy: pipelineBusy.subscribePipelineBusy,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE)); // present
    emitInbox(batch([{ id: 1 }], 1000));
    expect(pushed).toHaveLength(0);

    src.stop();
  });

  it("busy→idle edge (subscribePipelineBusy callback fires false) flushes ONE signals.catchup in arrival order, buffer cleared", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const pipelineBusy = fakePipelineBusy(true);

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: pipelineBusy.isPipelineBusy,
      subscribePipelineBusy: pipelineBusy.subscribePipelineBusy,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE)); // present, but busy
    emitInbox(batch([{ id: 1 }], 1000));
    emitInbox(batch([{ id: 2 }, { id: 3 }], 2000));
    expect(pushed).toHaveLength(0);

    // busy → idle edge.
    pipelineBusy.setBusy(false);

    expect(pushed).toHaveLength(1);
    const e = pushed[0];
    expect(e.event_name).toBe("signals.catchup");
    const p = e.payload as { signals: unknown[] };
    expect(p.signals).toEqual([{ items: [{ id: 1 }] }, { items: [{ id: 2 }, { id: 3 }] }]);

    // A second busy→idle edge with an empty buffer fires nothing further.
    pipelineBusy.setBusy(true);
    pipelineBusy.setBusy(false);
    expect(pushed).toHaveLength(1);

    src.stop();
  });

  it("present + idle (isPipelineBusy: () => false): fires immediately (existing behavior preserved)", async () => {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: () => false,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    emitInbox(batch([{ id: 1 }], 1000));
    expect(pushed).toHaveLength(1);
    expect(pushed[0].event_name).toBe("signals.push");

    src.stop();
  });
});

/** Pacer stub whose hold state the test drives directly. */
function fakePacer(holding: boolean): {
  isHolding: () => boolean;
  subscribe: (cb: (holding: boolean) => void) => () => void;
  setHolding: (holding: boolean) => void;
} {
  let current = holding;
  const subscribers = new Set<(holding: boolean) => void>();
  return {
    isHolding: () => current,
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    setHolding: (next) => {
      current = next;
      for (const cb of subscribers) cb(next);
    },
  };
}

describe("signals_source — global pacer composed into the busy predicate (#689)", () => {
  function startPaced() {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const pipelineBusy = fakePipelineBusy(false);
    const pacer = fakePacer(true);
    // The same composition bootstrap hands the buffered-inbox sources.
    const paced = composePacedPipelineBusy({
      pipelineBusy: {
        isBusy: pipelineBusy.isPipelineBusy,
        subscribe: pipelineBusy.subscribePipelineBusy,
      },
      pacer,
    });
    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
      isPipelineBusy: paced.isBusy,
      subscribePipelineBusy: paced.subscribe,
    });
    return { pushed, emitIdle, emitInbox, pacer, src };
  }

  it("buffers a live arrival while the pacer holds, though the pipeline itself is idle", async () => {
    const s = startPaced();
    await s.src.start();

    s.emitIdle(idleTick(LOW_IDLE)); // present
    s.emitInbox(batch([{ id: 1 }], 1000));

    expect(s.pushed).toHaveLength(0);
    s.src.stop();
  });

  it("flushes exactly ONE catchup on the window-open edge", async () => {
    const s = startPaced();
    await s.src.start();

    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1000));
    s.emitInbox(batch([{ id: 2 }], 2000));

    s.pacer.setHolding(false);

    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0].event_name).toBe("signals.catchup");
    const p = s.pushed[0].payload as { signals: unknown[] };
    expect(p.signals).toEqual([{ items: [{ id: 1 }] }, { items: [{ id: 2 }] }]);
    s.src.stop();
  });

  it("fires nothing on the window-open edge when the buffer is empty", async () => {
    const s = startPaced();
    await s.src.start();

    s.emitIdle(idleTick(LOW_IDLE));
    s.pacer.setHolding(false);

    expect(s.pushed).toHaveLength(0);
    s.src.stop();
  });
});

describe("signals_source — malformed payload (spec §7)", () => {
  it("null or undefined payload does not crash", async () => {
    const { bus } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await src.start();

    emitIdle(idleTick(LOW_IDLE));
    expect(() => emitInbox(null as unknown as SignalsBatch)).not.toThrow();
    expect(() => emitInbox(undefined as unknown as SignalsBatch)).not.toThrow();
    expect(() => emitInbox({} as unknown as SignalsBatch)).not.toThrow();

    src.stop();
  });
});

describe("signals_source — lifecycle (spec §8)", () => {
  it("start() is idempotent (calling twice does not double-subscribe)", async () => {
    const { bus } = fakeBus();
    const { listen } = fakeListen();
    const { onInbox } = fakeInbox();

    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      onInbox,
      listen,
    });
    await expect(src.start()).resolves.toBeUndefined();
    await expect(src.start()).resolves.toBeUndefined();
    expect(vi.mocked(onInbox)).toHaveBeenCalledTimes(1);

    src.stop();
  });

  it("stop() is safe off-Tauri (listen: undefined) and safe to call twice", async () => {
    const { bus } = fakeBus();
    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: () => true,
      listen: undefined,
    });
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
    expect(() => src.stop()).not.toThrow();
  });
});

describe("signals_source — delivery envelopes", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(
    options: { enabled?: () => boolean; busy?: ReturnType<typeof fakePipelineBusy> } = {},
  ) {
    const { bus, pushed } = fakeBus();
    const { listen, emit: emitIdle } = fakeListen();
    const { onInbox, emit: emitInbox } = fakeInbox();
    const src = createSignalsSource({
      bus,
      present_max_idle_ms: PRESENT_MAX,
      isEnabled: options.enabled ?? (() => true),
      onInbox,
      listen,
      isPipelineBusy: options.busy?.isPipelineBusy,
      subscribePipelineBusy: options.busy?.subscribePipelineBusy,
    });
    return { src, pushed, emitIdle, emitInbox, onInbox };
  }

  it("an explicit null envelope follows the legacy path without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, null));
    expect(s.pushed[0].payload).toEqual({ signals: [{ items: [{ id: 1 }] }] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("valid immediate envelope is preserved on a live push", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, ENVELOPE));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0].event_name).toBe("signals.push");
    expect(s.pushed[0].payload).toEqual({
      signals: [{ envelope: ENVELOPE, items: [{ id: 1 }] }],
    });
  });

  it("immediate envelope buffers while away and survives catch-up", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(HIGH_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, ENVELOPE));
    s.emitIdle(idleTick(LOW_IDLE));
    expect(s.pushed[0].event_name).toBe("signals.catchup");
    expect(s.pushed[0]!.payload!.signals).toEqual([{ envelope: ENVELOPE, items: [{ id: 1 }] }]);
  });

  it("batched delivery fires once at five minutes and re-arms only after a new arrival", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    const batched = { ...ENVELOPE, delivery: "batched" as const };
    s.emitInbox(batch([{ id: 1 }], 1, batched));
    s.emitInbox(batch([{ id: 2 }], 2, { ...batched, event_id: "run-2" }));
    expect(s.pushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0].event_name).toBe("signals.batch");
    expect(s.pushed[0]!.payload!.signals).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toHaveLength(1);
    s.emitInbox(batch([{ id: 3 }], 3, { ...batched, event_id: "run-3" }));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toHaveLength(2);
  });

  it("an ineligible timer holds batched groups, then one catch-up merges both buffers by arrival", async () => {
    const s = setup();
    await s.src.start();
    const batched = { ...ENVELOPE, delivery: "batched" as const };
    s.emitIdle(idleTick(HIGH_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1));
    s.emitInbox(batch([{ id: 2 }], 2, batched));
    s.emitInbox(batch([{ id: 3 }], 3));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);
    s.emitIdle(idleTick(LOW_IDLE));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0].event_name).toBe("signals.catchup");
    expect(
      (s.pushed[0]!.payload!.signals as Array<{ items: Array<{ id: number }> }>).map(
        (g) => g.items[0]!.id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it("a busy timer fire holds its batched group for one busy-to-idle catch-up", async () => {
    const busy = fakePipelineBusy(true);
    const s = setup({ busy });
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    const envelope = { ...ENVELOPE, delivery: "batched" as const };
    s.emitInbox(batch([{ id: 1 }], 1, envelope));

    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);

    busy.setBusy(false);
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]!.event_name).toBe("signals.catchup");
    expect(s.pushed[0]!.payload!.signals).toEqual([{ envelope, items: [{ id: 1 }] }]);
  });

  it("a batched group arriving away joins catch-up before its deadline", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(HIGH_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, { ...ENVELOPE, delivery: "batched" }));
    await vi.advanceTimersByTimeAsync(10_000);
    s.emitIdle(idleTick(LOW_IDLE));
    expect(s.pushed.map((e) => e.event_name)).toEqual(["signals.catchup"]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toHaveLength(1);
  });

  it.each([
    ["missing field", { ...ENVELOPE, source: undefined }],
    ["wrong type", { ...ENVELOPE, event_id: 7 }],
    ["unknown delivery", { ...ENVELOPE, delivery: "later" }],
    ["non-object", "bad"],
    ["non-finite occurred_at", { ...ENVELOPE, occurred_at: Number.POSITIVE_INFINITY }],
    ["out-of-range occurred_at", { ...ENVELOPE, occurred_at: 8.64e15 + 1 }],
  ])("%s envelope downgrades once and never loses items", async (_name, invalid) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([{ kept: true }], 1, invalid));
    expect(s.pushed[0].payload).toEqual({ signals: [{ items: [{ kept: true }] }] });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("an empty enveloped batch remains a content-less group", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([], 1, ENVELOPE));
    expect(s.pushed[0]!.payload!.signals).toEqual([{ envelope: ENVELOPE, items: [] }]);
  });

  it("duplicate event ids are not deduplicated", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(HIGH_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, ENVELOPE));
    s.emitInbox(batch([{ id: 2 }], 2, ENVELOPE));
    expect(s.src.drain()).toEqual([
      { envelope: ENVELOPE, items: [{ id: 1 }] },
      { envelope: ENVELOPE, items: [{ id: 2 }] },
    ]);
  });

  it("batch buffer retains five groups and cap eviction does not re-anchor the timer", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    const batched = { ...ENVELOPE, delivery: "batched" as const };
    for (let id = 8; id <= 14; id++) {
      s.emitInbox(batch([{ id }], id, { ...batched, event_id: `run-${id}` }));
      await vi.advanceTimersByTimeAsync(1_000);
    }
    await vi.advanceTimersByTimeAsync(292_999);
    expect(s.pushed).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.pushed[0]!.event_name).toBe("signals.batch");
    const groups = s.pushed[0]!.payload!.signals as Array<{ items: Array<{ id: number }> }>;
    expect(groups.map((g) => g.items[0]!.id)).toEqual([10, 11, 12, 13, 14]);
    expect(s.pushed).toHaveLength(1);
  });

  it("drain merges both buffers, clears the timer, and suppresses later firing", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(HIGH_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1));
    s.emitInbox(batch([{ id: 2 }], 2, { ...ENVELOPE, delivery: "batched" }));
    s.emitInbox(batch([{ id: 3 }], 3));
    expect(s.src.drain().map((g) => g.items[0])).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    s.emitIdle(idleTick(LOW_IDLE));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);
  });

  it("disable blocks timer fire, idle cleanup clears it, and re-enable starts clean", async () => {
    let enabled = true;
    const s = setup({ enabled: () => enabled });
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, { ...ENVELOPE, delivery: "batched" }));
    enabled = false;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);
    s.emitIdle(idleTick(LOW_IDLE));
    enabled = true;
    s.emitIdle(idleTick(HIGH_IDLE));
    s.emitIdle(idleTick(LOW_IDLE));
    expect(s.pushed).toEqual([]);
  });

  it("stop clears the timer, restart re-arms retained batches, and start is idempotent", async () => {
    const s = setup();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    s.emitInbox(batch([{ id: 1 }], 1, { ...ENVELOPE, delivery: "batched" }));
    s.src.stop();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed).toEqual([]);
    await s.src.start();
    await s.src.start();
    s.emitIdle(idleTick(LOW_IDLE));
    expect(vi.mocked(s.onInbox)).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(s.pushed.map((e) => e.event_name)).toEqual(["signals.batch"]);
  });
});
