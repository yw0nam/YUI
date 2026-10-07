import { describe, expect, it, vi } from "vitest";
import type { SignalGroup } from "../../../contract";
import type { OsEventListen, OsEventPayload } from "../../../io/window/tauri-listen";
import type { BusEnvelope, EventBus } from "../../core/event-bus";
import { createMilestoneSource } from "../idle-tick/milestone-source";
import { createWakeSource } from "./wake-source";

const T = new Date(2026, 5, 15, 8, 12, 0, 0).getTime();

function fakeBus(): { bus: Pick<EventBus, "push">; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  return {
    bus: {
      push: (env) => {
        pushed.push(env);
        return true;
      },
    },
    pushed,
  };
}

const group: SignalGroup = {
  envelope: {
    source: "n8n",
    event_type: "daily_briefing",
    delivery: "batched",
    event_id: "daily-briefing:2026-06-15",
    occurred_at: 1_787_449_000_000,
  },
  items: [{ skill: "yui-daily-briefing" }],
};

describe("createWakeSource", () => {
  it("pushes one wake naming its cause, and drains nothing when no first activity is owed", () => {
    const { bus, pushed } = fakeBus();
    const drainSignals = vi.fn(() => [group]);
    const wake = createWakeSource({
      bus,
      firstActivity: { owed: () => null, latch: vi.fn() },
      drainSignals,
      now: () => T,
    });

    wake.fire("click");

    expect(pushed).toEqual([
      {
        source: "os_event_watcher",
        event_name: "proactive.wake",
        ts: T,
        payload: { cause: "click" },
      },
    ]);
    expect(drainSignals).not.toHaveBeenCalled();
  });

  it("leaves the first activity owed when the bus rejects the wake", () => {
    const latch = vi.fn();
    const wake = createWakeSource({
      bus: { push: () => false },
      firstActivity: { owed: () => ({ name: "first_activity", local_time: "08:12" }), latch },
      drainSignals: () => [],
      now: () => T,
    });

    wake.fire("click");

    expect(latch).not.toHaveBeenCalled();
  });

  it("carries the held first activity, so the day's first launch reaches the bus once", async () => {
    const { bus, pushed } = fakeBus();
    let emit: (payload: OsEventPayload) => void = () => {};
    const listen: OsEventListen = async (_event, handler) => {
      emit = (payload) => handler({ payload });
      return () => {};
    };
    let fired: Record<string, string> = {};
    let held = true;
    const drainSignals = vi.fn(() => (drainSignals.mock.calls.length === 1 ? [group] : []));
    const milestone = createMilestoneSource({
      bus,
      present_max_idle_ms: 10_000,
      isEnabled: () => true,
      isHeld: () => held,
      drainSignals,
      firedStorage: { load: () => ({ ...fired }), save: (next) => (fired = { ...next }) },
      listen,
      now: () => T,
    });
    await milestone.start();
    const wake = createWakeSource({ bus, firstActivity: milestone, drainSignals, now: () => T });
    const tick = (): void => emit({ event_name: "os_idle_tick", ts: T, data: { os_idle_ms: 500 } });

    tick();
    expect(pushed).toEqual([]);

    wake.fire("timeout");
    held = false;
    tick();

    expect(pushed).toEqual([
      {
        source: "os_event_watcher",
        event_name: "proactive.wake",
        ts: T,
        payload: {
          cause: "timeout",
          name: "first_activity",
          local_time: "08:12",
          signals: [group],
        },
      },
    ]);
  });
});
