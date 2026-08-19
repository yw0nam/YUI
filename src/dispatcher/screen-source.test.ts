/**
 * screen-source.test.ts — frontmost-app transition firing source.
 *
 * Locks behavior over the shared `os_event` channel (`os_idle_tick` carrying frontmost fields):
 *  - app_switched: previous app held >= prev_dwell_ms, new app then settles settle_ms.
 *  - long_session: same app foreground for long_session_ms, re-marking each period.
 *  - app identity only — a window-title change is never a transition and never restarts dwell.
 *  - suppression reasons: disabled / not_present / min_gap / quiet_after_turn.
 *  - a suppressed long_session mark is skipped, not queued.
 *  - absence resets the dwell and long-session clocks; time away never counts.
 *  - every fire re-anchors the idle-cue gap via noteInteraction.
 */

import { describe, expect, it, vi } from "vitest";
import type { ScreenConfig } from "../config";
import type { InputContext } from "../contract";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { buildClientContext } from "./context-builder";
import type { BusEnvelope, EventBus } from "./event-bus";
import { createScreenSource } from "./screen-source";

const MIN = 60_000;
const PRESENT_MAX = 10_000;
const AWAY = 600_000;

const CFG: ScreenConfig = {
  prev_dwell_ms: 10 * MIN,
  settle_ms: 90_000,
  long_session_ms: 45 * MIN,
  min_gap_ms: 5 * MIN,
  quiet_after_turn_ms: 3 * MIN,
  recent_cap: 5,
};

function fakeBus(): { bus: Pick<EventBus, "push">; pushed: BusEnvelope[] } {
  const pushed: BusEnvelope[] = [];
  return {
    bus: {
      push: vi.fn((e: BusEnvelope) => {
        pushed.push(e);
        return true;
      }),
    },
    pushed,
  };
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
  return { listen, emit: (payload) => handler?.({ payload }), unlisten };
}

function tick(
  app: string | undefined,
  os_idle_ms: number | null = 500,
  title = "window",
): OsEventPayload {
  return {
    event_name: "os_idle_tick",
    ts: 0,
    data: {
      os_idle_ms,
      ...(app === undefined ? {} : { frontmost_app: app, frontmost_title: title }),
    },
  };
}

/** Source over a fake channel plus a controllable clock. `at` sets the tick timestamp. */
function setup(over: Partial<Parameters<typeof createScreenSource>[0]> = {}) {
  const { bus, pushed } = fakeBus();
  const { listen, emit, unlisten } = fakeListen();
  const noteInteraction = vi.fn();
  const appendSkipRecord = vi.fn();
  let busyCb: ((busy: boolean) => void) | undefined;
  const unsubscribeBusy = vi.fn();
  const subscribeBusy = vi.fn((cb: (busy: boolean) => void) => {
    busyCb = cb;
    return unsubscribeBusy;
  });
  let t = 0;
  const src = createScreenSource({
    bus,
    present_max_idle_ms: PRESENT_MAX,
    getConfig: () => CFG,
    isEnabled: () => true,
    noteInteraction,
    subscribeBusy,
    listen,
    now: () => t,
    appendSkipRecord,
    ...over,
  });
  return {
    src,
    pushed,
    unlisten,
    noteInteraction,
    subscribeBusy,
    unsubscribeBusy,
    appendSkipRecord,
    at(ms: number, payload: OsEventPayload) {
      t = ms;
      emit(payload);
    },
    turnAt(ms: number) {
      t = ms;
      busyCb?.(true);
      busyCb?.(false);
    },
  };
}

describe("screen_source — app_switched", () => {
  it("fires once the departed app's dwell and the new app's settle are both met", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack")); // identity change arms the pending switch
    expect(s.pushed).toHaveLength(0);

    s.at(10 * MIN + 89_000, tick("Slack")); // still settling
    expect(s.pushed).toHaveLength(0);

    s.at(10 * MIN + 90_000, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]).toMatchObject({
      source: "screen_watcher",
      event_name: "proactive.screen_app_switched",
      ts: 10 * MIN + 90_000,
      hint_tier: 2,
      dnd_override: false,
      payload: {
        transition: "app_switched",
        from_app: "Cursor",
        from_dwell_min: 10,
        dwell_min: 2,
      },
    });
  });

  it("does not fire when the departed app held the foreground for less than prev_dwell_ms", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN - 1, tick("Slack"));
    s.at(10 * MIN - 1 + 90_000, tick("Slack"));
    expect(s.pushed).toHaveLength(0);
  });

  it("consumes the pending switch at settle — a rejected switch never fires later", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(5 * MIN, tick("Slack")); // departed dwell too short
    s.at(5 * MIN + 90_000, tick("Slack"));
    s.at(30 * MIN, tick("Slack"));
    expect(s.pushed).toHaveLength(0);
  });

  it("carries no cue — screen turns describe the transition, not an authored cue", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack"));
    expect(s.pushed[0]?.payload).not.toHaveProperty("cue_id");
    expect(s.pushed[0]?.payload).not.toHaveProperty("label");
  });
});

describe("screen_source — app identity is the only clock", () => {
  it("treats a window-title change as no transition and keeps the dwell running", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor", 500, "a.ts"));
    s.at(5 * MIN, tick("Cursor", 500, "b.ts"));
    s.at(9 * MIN, tick("Cursor", 500, "c.ts"));
    expect(s.pushed).toHaveLength(0);

    // Dwell is measured from the app taking focus, not from the last title restamp.
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).toMatchObject({ from_app: "Cursor", from_dwell_min: 10 });
  });

  it("holds the dwell across a tick with no frontmost app (desktop shown)", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(5 * MIN, tick(undefined));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).toMatchObject({ from_app: "Cursor", from_dwell_min: 10 });
  });
});

describe("screen_source — long_session", () => {
  it("marks at long_session_ms and re-marks each period", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN - 1, tick("Cursor"));
    expect(s.pushed).toHaveLength(0);

    s.at(45 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]).toMatchObject({
      event_name: "proactive.screen_long_session",
      payload: { transition: "long_session", dwell_min: 45 },
    });
    expect(s.pushed[0]?.payload).not.toHaveProperty("from_app");
    expect(s.pushed[0]?.payload).not.toHaveProperty("from_dwell_min");

    s.at(90 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(2);
    expect(s.pushed[1]?.payload).toMatchObject({ dwell_min: 90 });
  });

  it("restarts the session clock when the frontmost app changes", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(5 * MIN, tick("Slack")); // dwell too short to be a switch, but it restarts the session
    s.at(45 * MIN, tick("Slack"));
    expect(s.pushed).toHaveLength(0);

    s.at(50 * MIN, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).toMatchObject({ transition: "long_session", dwell_min: 45 });
  });

  it("skips a suppressed mark instead of queueing it — the next fire is the next mark", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.turnAt(45 * MIN - 1_000); // a turn just before the mark
    s.at(45 * MIN, tick("Cursor")); // mark falls inside quiet_after_turn
    expect(s.pushed).toHaveLength(0);

    // The quiet window expiring does not release the skipped mark.
    s.at(49 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(0);

    s.at(90 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).toMatchObject({ dwell_min: 90 });
  });
});

describe("screen_source — suppression", () => {
  it("refuses to fire within min_gap_ms of the previous fire", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor")); // long_session fire
    expect(s.pushed).toHaveLength(1);

    s.at(45 * MIN + 1_000, tick("Slack")); // departed dwell 45 min — a valid switch
    s.at(45 * MIN + 91_000, tick("Slack"));
    expect(s.pushed).toHaveLength(1);

    // The consumed switch does not fire once the gap expires.
    s.at(51 * MIN, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
  });

  it("refuses to fire within quiet_after_turn_ms of any turn", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.turnAt(10 * MIN + 60_000);
    s.at(10 * MIN + 90_000, tick("Slack"));
    expect(s.pushed).toHaveLength(0);
  });

  it("fires again once the quiet window has passed", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.turnAt(1_000);
    s.at(45 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(1);
  });

  it("never fires while the enabled flag is off", async () => {
    const s = setup({ isEnabled: () => false });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(0);
  });

  it("never fires while the user is away", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack", AWAY)); // settles on an away tick
    expect(s.pushed).toHaveLength(0);
  });

  it("ignores ticks carrying no idle reading (no presence signal)", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor", null));
    expect(s.pushed).toHaveLength(0);

    s.at(45 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(1);
  });
});

describe("screen_source — skip records", () => {
  it("appends a skip record with reason=disabled and the transition kind", async () => {
    const s = setup({ isEnabled: () => false });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));

    expect(s.pushed).toHaveLength(0);
    expect(s.appendSkipRecord).toHaveBeenCalledOnce();
    expect(s.appendSkipRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "skip",
        source: "screen",
        reason: "disabled",
        transition: "long_session",
      }),
    );
  });

  it("appends a skip record with reason=not_present when the settling tick lands while away", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack", AWAY));

    expect(s.pushed).toHaveLength(0);
    expect(s.appendSkipRecord).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "not_present", transition: "app_switched" }),
    );
  });

  it("appends a skip record with reason=min_gap; the accepted fire itself does not append", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor")); // accepted long_session fire
    expect(s.appendSkipRecord).not.toHaveBeenCalled();

    s.at(45 * MIN + 1_000, tick("Slack"));
    s.at(45 * MIN + 91_000, tick("Slack")); // switch within min_gap of the prior fire

    expect(s.appendSkipRecord).toHaveBeenCalledOnce();
    expect(s.appendSkipRecord).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "min_gap", transition: "app_switched" }),
    );
  });

  it("appends a skip record with reason=quiet_after_turn", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.turnAt(10 * MIN + 60_000);
    s.at(10 * MIN + 90_000, tick("Slack"));

    expect(s.appendSkipRecord).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "quiet_after_turn", transition: "app_switched" }),
    );
  });

  it("appends a skip record with reason=global_gap while the global pacer holds", async () => {
    const s = setup({ isPacerHolding: () => true });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack"));

    expect(s.pushed).toHaveLength(0);
    expect(s.appendSkipRecord).toHaveBeenCalledOnce();
    expect(s.appendSkipRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "skip",
        source: "screen",
        reason: "global_gap",
        transition: "app_switched",
      }),
    );
  });

  it("fires normally once the pacer's window has opened", async () => {
    let holding = true;
    const s = setup({ isPacerHolding: () => holding });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor")); // long_session mark held back
    expect(s.pushed).toHaveLength(0);

    holding = false;
    s.at(90 * MIN, tick("Cursor")); // the next mark passes
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.event_name).toBe("proactive.screen_long_session");
  });

  it("a throwing appendSkipRecord is swallowed — the source keeps ticking without throwing", async () => {
    const s = setup({
      isEnabled: () => false,
      appendSkipRecord: vi.fn(() => {
        throw new Error("disk full");
      }),
    });
    await s.src.start();

    expect(() => s.at(0, tick("Cursor"))).not.toThrow();
    expect(() => s.at(45 * MIN, tick("Cursor"))).not.toThrow();
  });
});

describe("screen_source — absence resets the clocks", () => {
  it("never counts dwell accrued before an absence toward a post-return switch", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(20 * MIN, tick("Cursor", AWAY)); // presence lapses
    s.at(21 * MIN, tick("Cursor")); // returns — dwell restarts here
    s.at(25 * MIN, tick("Slack")); // Cursor has only held 4 min since the return
    s.at(25 * MIN + 90_000, tick("Slack"));
    expect(s.pushed).toHaveLength(0);
  });

  it("drops the pre-absence session time so time away never counts", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(30 * MIN, tick("Cursor", AWAY));
    s.at(40 * MIN, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(0);

    s.at(85 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).toMatchObject({ dwell_min: 45 });
  });
});

describe("screen_source — pile-on avoidance", () => {
  it("re-anchors the idle-cue gap on every fire", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));
    expect(s.noteInteraction).toHaveBeenCalledTimes(1);

    s.at(90 * MIN, tick("Cursor"));
    expect(s.noteInteraction).toHaveBeenCalledTimes(2);
  });

  it("does not re-anchor when the fire was suppressed", async () => {
    const s = setup({ isEnabled: () => false });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));
    expect(s.noteInteraction).not.toHaveBeenCalled();
  });
});

describe("screen_source — recent buffer", () => {
  it("reorders global_gap ahead of quiet_after_turn/min_gap and lands the suppressed switch in the buffer", async () => {
    let holding = false;
    const s = setup({ isPacerHolding: () => holding });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor")); // accepted long_session fire — lastFireTs = 45min
    expect(s.pushed).toHaveLength(1);

    s.turnAt(45 * MIN + 30_000); // lastTurnTs = 45min30s

    holding = true;
    s.at(45 * MIN + 40_000, tick("Slack")); // arms the pending switch (Cursor dwell ~45.7min)
    // settles 100s after the turn (< quiet_after_turn_ms) and 130s after the last fire (< min_gap_ms) —
    // both older reasons would also apply, yet the reorder makes global_gap win.
    s.at(45 * MIN + 130_000, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
    expect(s.appendSkipRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "global_gap", transition: "app_switched" }),
    );

    holding = false;
    s.at(45 * MIN + 40_000 + 45 * MIN, tick("Slack")); // next long_session mark ships the buffer
    expect(s.pushed).toHaveLength(2);
    expect(s.pushed[1]).toMatchObject({
      payload: { recent: [{ from_app: "Cursor", to_app: "Slack", dwell_min: 46 }] },
    });

    s.at(45 * MIN + 40_000 + 90 * MIN, tick("Slack")); // nothing held this time — buffer cleared after ship
    expect(s.pushed).toHaveLength(3);
    expect(s.pushed[2]?.payload).not.toHaveProperty("recent");
  });

  it("does not accumulate a suppressed long_session mark — it is not a transition", async () => {
    let holding = true;
    const s = setup({ isPacerHolding: () => holding });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor")); // long_session suppressed by global_gap
    expect(s.pushed).toHaveLength(0);

    holding = false;
    s.at(90 * MIN, tick("Cursor")); // next mark fires with an open pacer
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).not.toHaveProperty("recent");
  });

  it("drops the oldest entry once the buffer exceeds recent_cap", async () => {
    let holding = true;
    const cfg2: ScreenConfig = { ...CFG, recent_cap: 2 };
    const s = setup({ isPacerHolding: () => holding, getConfig: () => cfg2 });
    await s.src.start();

    s.at(0, tick("App1"));
    s.at(10 * MIN, tick("App2")); // App1 dwell 10min
    s.at(10 * MIN + 90_000, tick("App2")); // suppressed switch 1: App1 -> App2

    s.at(20 * MIN, tick("App3")); // App2 dwell 10min
    s.at(20 * MIN + 90_000, tick("App3")); // suppressed switch 2: App2 -> App3

    s.at(30 * MIN, tick("App4")); // App3 dwell 10min
    s.at(30 * MIN + 90_000, tick("App4")); // suppressed switch 3: App3 -> App4, overflow drops switch 1
    expect(s.pushed).toHaveLength(0);

    holding = false;
    s.at(75 * MIN, tick("App4")); // long_session mark ships the buffer
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]).toMatchObject({
      payload: {
        recent: [
          { from_app: "App2", to_app: "App3", dwell_min: 10 },
          { from_app: "App3", to_app: "App4", dwell_min: 10 },
        ],
      },
    });
  });

  it("clears the buffer when a candidate is refused because the feature is disabled", async () => {
    let holding = true;
    let enabled = true;
    const s = setup({ isPacerHolding: () => holding, isEnabled: () => enabled });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack")); // buffered: Cursor -> Slack

    enabled = false;
    s.at(55 * MIN, tick("Slack")); // next mark refused with reason=disabled — clears the buffer
    expect(s.appendSkipRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "disabled", transition: "long_session" }),
    );

    enabled = true;
    holding = false;
    s.at(100 * MIN, tick("Slack")); // fires with an empty buffer
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).not.toHaveProperty("recent");
  });

  it("accumulates nothing when recent_cap is 0", async () => {
    let holding = true;
    const cfg0: ScreenConfig = { ...CFG, recent_cap: 0 };
    const s = setup({ isPacerHolding: () => holding, getConfig: () => cfg0 });
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack")); // suppressed — cap 0 accumulates nothing
    expect(s.appendSkipRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({ reason: "global_gap" }),
    );

    holding = false;
    s.at(55 * MIN, tick("Slack"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).not.toHaveProperty("recent");
  });

  it("never includes a recent key on a fire whose buffer is empty", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));
    expect(s.pushed).toHaveLength(1);
    expect(s.pushed[0]?.payload).not.toHaveProperty("recent");
  });
});

describe("screen_source — lifecycle", () => {
  it("subscribes once and releases both subscriptions on stop", async () => {
    const s = setup();
    await s.src.start();
    await s.src.start();

    expect(s.subscribeBusy).toHaveBeenCalledTimes(1);
    s.src.stop();
    expect(s.unlisten).toHaveBeenCalledTimes(1);
    expect(s.unsubscribeBusy).toHaveBeenCalledTimes(1);
  });

  it("degrades to a no-op when the channel cannot be subscribed", async () => {
    const src = createScreenSource({
      bus: fakeBus().bus,
      present_max_idle_ms: PRESENT_MAX,
      getConfig: () => CFG,
      isEnabled: () => true,
      listen: vi.fn(async () => {
        throw new Error("no tauri");
      }),
    });
    await expect(src.start()).resolves.toBeUndefined();
    expect(() => src.stop()).not.toThrow();
  });
});

describe("screen_source — envelope reaches the backend contract", () => {
  const CTX: InputContext = { env: { timestamp: "2026-08-16T14:22:33+09:00", timezone: "UTC" } };

  it("produces a client context carrying trigger.screen and no cue", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(10 * MIN, tick("Slack"));
    s.at(10 * MIN + 90_000, tick("Slack"));

    const client = buildClientContext(CTX, s.pushed[0]!);
    expect(client.trigger.kind).toBe("proactive");
    expect(client.trigger.screen).toEqual({
      transition: "app_switched",
      from_app: "Cursor",
      from_dwell_min: 10,
      dwell_min: 2,
    });
    expect("cue" in client.trigger).toBe(false);
  });

  it("produces a long_session context without the app_switched-only fields", async () => {
    const s = setup();
    await s.src.start();

    s.at(0, tick("Cursor"));
    s.at(45 * MIN, tick("Cursor"));

    const client = buildClientContext(CTX, s.pushed[0]!);
    expect(client.trigger.screen).toEqual({ transition: "long_session", dwell_min: 45 });
  });
});
