/**
 * event-bus.test.ts — Event bus contract (event-dispatcher.md §4).
 *
 * Locks §4.1 envelope, §4.2 queue policy (priority heap key=(tier ASC, ts ASC),
 * capacity 100 lowest-priority drop, bus-drop on schema-invalid / unknown event_name / ts±60s),
 * §4.3 priorities + FIFO within tier.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEventBus, type BusEnvelope, type EventBus } from "./event-bus";

const NOW = 1_717_000_000_000;

function env(over: Partial<BusEnvelope> = {}): BusEnvelope {
  return {
    source: "user_input_source",
    event_name: "user.text_submitted",
    ts: NOW,
    dnd_override: true,
    ...over,
  };
}

let bus: EventBus;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  bus = createEventBus();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("event_bus — push / seq_id (§4.1)", () => {
  it("accepts a valid envelope and assigns a monotonic seq_id", () => {
    expect(bus.push(env())).toBe(true);
    expect(bus.push(env({ event_name: "user.tap" }))).toBe(true);
    const snap = bus.snapshot();
    expect(snap).toHaveLength(2);
    expect(typeof snap[0].seq_id).toBe("number");
    expect(snap[1].seq_id! > snap[0].seq_id!).toBe(true);
  });
});

describe("event_bus — bus drop conditions (§4.2)", () => {
  it("drops an unknown event_name", () => {
    expect(bus.push(env({ event_name: "totally.unknown" }))).toBe(false);
    expect(bus.snapshot()).toHaveLength(0);
  });

  it("drops a schema-invalid envelope (missing event_name)", () => {
    // @ts-expect-error intentionally invalid
    expect(bus.push(env({ event_name: undefined }))).toBe(false);
  });

  it("drops an envelope whose ts is more than 60s in the past", () => {
    expect(bus.push(env({ ts: NOW - 61_000 }))).toBe(false);
  });

  it("drops an envelope whose ts is more than 60s in the future", () => {
    expect(bus.push(env({ ts: NOW + 61_000 }))).toBe(false);
  });

  it("accepts an envelope within the ±60s window", () => {
    expect(bus.push(env({ ts: NOW - 59_000 }))).toBe(true);
    expect(bus.push(env({ ts: NOW + 59_000 }))).toBe(true);
  });
});

describe("event_bus — priority ordering (§4.3)", () => {
  it("pops by tier ASC (user before idle before os)", () => {
    bus.push(env({ source: "os_event_watcher", event_name: "os.active_app_changed", ts: NOW, dnd_override: false }));
    bus.push(env({ source: "idle_watcher", event_name: "idle.short", ts: NOW, dnd_override: false }));
    bus.push(env({ source: "user_input_source", event_name: "user.text_submitted", ts: NOW }));
    expect(bus.pop()!.event_name).toBe("user.text_submitted");
    expect(bus.pop()!.event_name).toBe("idle.short");
    expect(bus.pop()!.event_name).toBe("os.active_app_changed");
    expect(bus.pop()).toBeNull();
  });

  it("keeps FIFO order within the same priority tier (ts ASC, then seq)", () => {
    bus.push(env({ event_name: "user.tap", ts: NOW + 10 }));
    bus.push(env({ event_name: "user.text_submitted", ts: NOW }));
    // earlier ts pops first
    expect(bus.pop()!.event_name).toBe("user.text_submitted");
    expect(bus.pop()!.event_name).toBe("user.tap");
  });

  it("breaks ts ties by insertion order (FIFO)", () => {
    bus.push(env({ event_name: "user.text_submitted", ts: NOW }));
    bus.push(env({ event_name: "user.tap", ts: NOW }));
    expect(bus.pop()!.event_name).toBe("user.text_submitted");
    expect(bus.pop()!.event_name).toBe("user.tap");
  });
});

describe("event_bus — proactive.* family (#24 Step 5)", () => {
  it("accepts proactive.cowork (not unknown_event_name-dropped)", () => {
    expect(
      bus.push(env({ source: "timer_scheduler", event_name: "proactive.cowork", ts: NOW, dnd_override: false })),
    ).toBe(true);
    expect(bus.snapshot()).toHaveLength(1);
  });

  it("gives proactive.* priority 2 — after user.* (0), before os.* (3)", () => {
    bus.push(env({ source: "os_event_watcher", event_name: "os.active_app_changed", ts: NOW, dnd_override: false }));
    bus.push(env({ source: "timer_scheduler", event_name: "proactive.cowork", ts: NOW, dnd_override: false }));
    bus.push(env({ source: "user_input_source", event_name: "user.text_submitted", ts: NOW }));
    expect(bus.pop()!.event_name).toBe("user.text_submitted");
    expect(bus.pop()!.event_name).toBe("proactive.cowork");
    expect(bus.pop()!.event_name).toBe("os.active_app_changed");
    expect(bus.pop()).toBeNull();
  });
});

describe("event_bus — capacity 100 (§4.2)", () => {
  it("drops the lowest-priority entry when over capacity, keeping high-priority", () => {
    const drops: unknown[] = [];
    bus = createEventBus({ onDrop: (e, reason) => drops.push({ e: e.event_name, reason }) });
    // Fill with 100 low-priority os events.
    for (let i = 0; i < 100; i++) {
      bus.push(env({ source: "os_event_watcher", event_name: "os.active_app_changed", ts: NOW + i, dnd_override: false }));
    }
    expect(bus.snapshot()).toHaveLength(100);
    // 101st is a high-priority user event → must be inserted, an os event dropped.
    expect(bus.push(env({ event_name: "user.text_submitted", ts: NOW }))).toBe(true);
    expect(bus.snapshot()).toHaveLength(100);
    expect(drops).toHaveLength(1);
    // The first thing popped should now be the user event.
    expect(bus.pop()!.event_name).toBe("user.text_submitted");
  });
});

describe("event_bus — drop callback / dev observability", () => {
  it("invokes onDrop with a reason for bus-drops", () => {
    const onDrop = vi.fn();
    bus = createEventBus({ onDrop });
    bus.push(env({ event_name: "nope.unknown" }));
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
