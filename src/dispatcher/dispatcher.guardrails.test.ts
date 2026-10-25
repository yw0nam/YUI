/**
 * dispatcher.guardrails.test.ts — §6 guardrail gating and the global proactive pacer gate.
 *
 * Scope:
 *  - §6 guardrail gating: debounce/rate-limit/cooldown drops reaching backend_caller.
 *  - The global proactive pacer gate: a hold silences proactive/loop-cue fires but never a
 *    gesture cue or a user turn, and never spends a guardrail slot on a held fire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/validators/avatar/types";
import type { Logger } from "../logger";
import type { BackendCaller } from "./backend/backend-caller";
import { type BusEnvelope, createEventBus, type EventBus } from "./core/event-bus";
import { createGuardrails, type Guardrails } from "./core/guardrails";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import {
  createDefaultAddressedChain,
  type DeferredCall,
  env,
  makeDeferredBackendCaller,
  makeLogger,
  NOW,
  permissiveGuardrailsConfig,
  realGuardrailsConfig,
  userEnv,
} from "./test-helpers";
import { createTurnLog, type TurnLog } from "./turn/turn";

const PEEK_CONFIG: PeekConfig = {
  side_out_frac: 0.28,
  side_in_frac: 0.23,
  inset_frac: 0.12,
  mirror_side: "right",
};

const TAP_CONFIG: TapConfig = {
  spam_count: 4,
  spam_window_ms: 3_000,
  region_radius_frac: 0.18,
  region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
  bored_cue: { label: "bored poking", context: "The user is poking repeatedly." },
  touch_cue_cooldown_ms: 60_000,
  touch_emotion_hold_ms: 4_000,
  pat_hold_ms: 300,
};

let bus: EventBus;
let applyDirective: ReturnType<typeof vi.fn>;
let setPerchTarget: ReturnType<typeof vi.fn>;
let setPeekTarget: ReturnType<typeof vi.fn>;
let setMotionMirror: ReturnType<typeof vi.fn>;
let easeEmotionToNeutral: ReturnType<typeof vi.fn>;
let renderer: {
  applyDirective: typeof applyDirective;
  setPerchTarget: typeof setPerchTarget;
  setPeekTarget: typeof setPeekTarget;
  setMotionMirror: typeof setMotionMirror;
  easeEmotionToNeutral: typeof easeEmotionToNeutral;
};
let peekEnter: ReturnType<typeof vi.fn<() => Promise<void>>>;
let peekExit: ReturnType<typeof vi.fn<() => Promise<void>>>;
let callDeferred: DeferredCall[];
let backendCaller: BackendCaller;
let guardrails: Guardrails;
let dispatcher: Dispatcher;
let logger: Logger;
let turnLog: TurnLog;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  bus = createEventBus();
  applyDirective = vi.fn();
  setPerchTarget = vi.fn();
  setPeekTarget = vi.fn();
  setMotionMirror = vi.fn();
  easeEmotionToNeutral = vi.fn();
  peekEnter = vi.fn().mockResolvedValue(undefined);
  peekExit = vi.fn().mockResolvedValue(undefined);
  renderer = {
    applyDirective,
    setPerchTarget,
    setPeekTarget,
    setMotionMirror,
    easeEmotionToNeutral,
  };
  callDeferred = [];
  backendCaller = makeDeferredBackendCaller(callDeferred);
  guardrails = createGuardrails(permissiveGuardrailsConfig(), { now: () => Date.now() });
  logger = makeLogger();
  turnLog = createTurnLog();
  const deps = {
    bus,
    renderer: renderer as never,
    backendCaller,
    guardrails,
    turnLog,
    hasOutstandingSpeech: () => false,
    peek: { enter: peekEnter, exit: peekExit },
    logger,
    peekConfig: () => PEEK_CONFIG,
    tapConfig: () => TAP_CONFIG,
    addressedChain: createDefaultAddressedChain(),
  };
  dispatcher = createDispatcher(deps);
});
afterEach(() => {
  dispatcher.stop();
  vi.useRealTimers();
});

describe("dispatcher — addressed chain cap", () => {
  function addressedEnv(seqId: number): BusEnvelope {
    return {
      seq_id: seqId,
      source: "addressed_source",
      event_name: "addressed.character",
      ts: NOW + seqId,
      payload: { from: "perlica", name: "Perlica", line: "natsume, you took my chair" },
    };
  }

  /** Push one addressed envelope and let its turn begin and settle. */
  async function runAddressed(seqId: number): Promise<void> {
    bus.push(addressedEnv(seqId));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred.at(-1)?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
  }

  it("drops the third addressed turn in a row as addressed_cap, logged at info", async () => {
    dispatcher.start();
    await runAddressed(1);
    await runAddressed(2);
    await runAddressed(3);

    expect(dispatcher.recentDrops()).toContainEqual(
      expect.objectContaining({ event_name: "addressed.character", reason: "addressed_cap" }),
    );
    expect(logger.info).toHaveBeenCalledWith("drop", {
      event_name: "addressed.character",
      reason: "addressed_cap",
      seq_id: 3,
    });
  });

  it("a user turn in between resets the chain", async () => {
    dispatcher.start();
    await runAddressed(1);
    await runAddressed(2);
    bus.push(userEnv("hello"));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred.at(-1)?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    await runAddressed(3);

    expect(dispatcher.recentDrops()).not.toContainEqual(
      expect.objectContaining({ reason: "addressed_cap" }),
    );
  });

  it("a cap-dropped envelope spends no tier2 slot — the next cue still passes", async () => {
    dispatcher.start();
    await runAddressed(1);
    await runAddressed(2);
    const evaluate = vi.spyOn(guardrails, "evaluate");
    await runAddressed(3);
    expect(evaluate).not.toHaveBeenCalled();

    bus.push({
      seq_id: 9,
      source: "os_event_watcher",
      event_name: "proactive.touch_chest",
      ts: NOW + 9,
      payload: { cue_id: "touch_chest", label: "chest poked" },
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(3);
  });

  it("an addressed envelope superseded before it began does not count", async () => {
    dispatcher.start();
    bus.push({
      seq_id: 1,
      source: "os_event_watcher",
      event_name: "proactive.touch_chest",
      ts: NOW + 1,
      payload: { cue_id: "touch_chest", label: "chest poked" },
    });
    await vi.advanceTimersByTimeAsync(20);
    // In flight — the addressed envelope defers into pending, un-begun.
    bus.push(addressedEnv(2));
    await vi.advanceTimersByTimeAsync(20);
    bus.push(userEnv("hello"));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred.at(-1)?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(dispatcher.recentDrops()).toContainEqual(
      expect.objectContaining({ reason: "superseded_by_user" }),
    );

    await runAddressed(3);
    await runAddressed(4);
    expect(dispatcher.recentDrops()).not.toContainEqual(
      expect.objectContaining({ reason: "addressed_cap" }),
    );
  });

  it("onTurnClosed fires once per turn at the over edge, and with the displaced turn's values when the next begins", async () => {
    const onTurnClosed = vi.fn();
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => false,
      logger,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      addressedChain: createDefaultAddressedChain(),
      onTurnClosed,
    });
    d.start();
    bus.push(addressedEnv(1));
    await vi.advanceTimersByTimeAsync(20);
    const id = turnLog.current()!.id;
    turnLog.setSpokeText(id, true);
    callDeferred.at(-1)?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    expect(onTurnClosed).toHaveBeenCalledTimes(1);
    expect(onTurnClosed).toHaveBeenCalledWith({ id, outcome: "ok", spokeText: true });

    // Displacement: the user speaks while the turn is still open — the next begin closes it.
    onTurnClosed.mockClear();
    bus.push(addressedEnv(2));
    await vi.advanceTimersByTimeAsync(20);
    const id2 = turnLog.current()!.id;
    turnLog.setSpokeText(id2, true);
    bus.push(userEnv("hello"));
    await vi.advanceTimersByTimeAsync(20);
    expect(onTurnClosed).toHaveBeenCalledTimes(1);
    expect(onTurnClosed).toHaveBeenCalledWith({
      id: id2,
      outcome: "superseded_by_user",
      spokeText: true,
    });
    d.stop();
  });

  it("a throwing onTurnClosed is warned once per turn and leaves the next turn runnable", async () => {
    const onTurnClosed = vi.fn(() => {
      throw new Error("hook down");
    });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => false,
      logger,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      addressedChain: createDefaultAddressedChain(),
      onTurnClosed,
    });
    d.start();
    await runAddressed(1);
    expect(onTurnClosed).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("turn_hook_failed", {
      error: "Error: hook down",
    });

    await runAddressed(2);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
    expect(onTurnClosed).toHaveBeenCalledTimes(2);
    d.stop();
  });
});

describe("dispatcher — routed user turns", () => {
  function routedEnv(payload: Record<string, unknown>): BusEnvelope {
    return { ...userEnv("hi"), payload: { text: "hi", ...payload } };
  }

  function make(hooks: {
    onTurnClosed?: ReturnType<typeof vi.fn>;
    onTurnDropped?: ReturnType<typeof vi.fn>;
  }): Dispatcher {
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails,
      turnLog,
      hasOutstandingSpeech: () => false,
      logger,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      addressedChain: createDefaultAddressedChain(),
      ...hooks,
    });
    d.start();
    return d;
  }

  it("reports the send id of a routed user turn when it closes", async () => {
    const onTurnClosed = vi.fn();
    const d = make({ onTurnClosed });
    bus.push(routedEnv({ send_id: "s1" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred.at(-1)?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    expect(onTurnClosed).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sendId: "s1" }));
    d.stop();
  });

  it("reports no send id for a user turn typed in the window", async () => {
    const onTurnClosed = vi.fn();
    const d = make({ onTurnClosed });
    bus.push(routedEnv({}));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred.at(-1)?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    expect(onTurnClosed.mock.calls[0]?.[0]).not.toHaveProperty("sendId");
    d.stop();
  });

  it("hands the envelope of a turn that failed before speaking to onTurnDropped", async () => {
    const onTurnDropped = vi.fn();
    const d = make({ onTurnDropped });
    bus.push(routedEnv({ send_id: "s1" }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred.at(-1)?.resolve("not_configured");
    await vi.advanceTimersByTimeAsync(20);

    expect(onTurnDropped).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { text: "hi", send_id: "s1" } }),
      "not_configured",
    );
    d.stop();
  });
});

describe("dispatcher — guardrail gating (§6)", () => {
  /** Create dispatcher with real-config (§6 values) guardrails. */
  function makeGated(): { d: Dispatcher; g: Guardrails } {
    const g = createGuardrails(realGuardrailsConfig(), { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
      hasOutstandingSpeech: () => false,
      addressedChain: createDefaultAddressedChain(),
      logger,
    });
    return { d, g };
  }

  it("drops proactive.tap_bored during cooldown", async () => {
    const cfg = realGuardrailsConfig();
    cfg.rate_limit.tier2_max = 1000;
    cfg.debounce_ms.user_input_source = 0;
    const g = createGuardrails(cfg, { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
      hasOutstandingSpeech: () => false,
      addressedChain: createDefaultAddressedChain(),
      logger,
    });
    d.start();
    for (let i = 0; i < 21; i++) {
      g.evaluate(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
      );
    }
    expect(g.cooldownActive()).toBe(true);
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.tap_bored",
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(d.recentDrops(10).some((dr) => dr.reason === "guardrail_drop")).toBe(true);
    d.stop();
  });

  it("debounce drops a 2nd same-source tier2 within the window", async () => {
    const { d } = makeGated();
    d.start();
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.drag_held",
        ts: NOW,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0]?.resolve("ok");
    await vi.advanceTimersByTimeAsync(20);
    (backendCaller.call as ReturnType<typeof vi.fn>).mockClear();
    // 2nd os_event_watcher fire within 5s — debounce drop, no new backend call.
    bus.push(
      env({
        source: "os_event_watcher",
        event_name: "proactive.drag_held",
        ts: NOW + 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(d.recentDrops(10).some((dr) => dr.reason === "guardrail_drop")).toBe(true);
    d.stop();
  });
});

describe("dispatcher — global proactive pacer gate", () => {
  /** Pacer stub: a turn start anchors the hold, exactly as the real pacer does. */
  function fakePacer(holding: boolean) {
    let current = holding;
    return {
      isHolding: () => current,
      noteTurnStart: vi.fn(() => {
        current = true;
      }),
      open(): void {
        current = false;
      },
    };
  }

  function proactiveEnv(over: Partial<BusEnvelope> = {}): BusEnvelope {
    return {
      source: "screen_watcher",
      event_name: "proactive.screen_app_switched",
      ts: NOW,
      dnd_override: false,
      ...over,
    };
  }

  /** A loop cue / schedule / signals / agent fire — everything the timer scheduler pushes. */
  const loopCueEnv = (over: Partial<BusEnvelope> = {}): BusEnvelope =>
    proactiveEnv({ source: "timer_scheduler", event_name: "proactive.cowork", ...over });

  /** A gesture cue — a physical interaction the user just made, never paced. */
  const gestureEnv = (over: Partial<BusEnvelope> = {}): BusEnvelope =>
    proactiveEnv({ source: "os_event_watcher", event_name: "proactive.touch_head", ...over });

  function build(
    pacer: ReturnType<typeof fakePacer>,
    appendSkipRecord: () => void,
    over: {
      guardrails?: Guardrails;
      onTurnDropped?: (env: BusEnvelope, reason: string) => void;
    } = {},
  ) {
    return createDispatcher({
      bus,
      renderer: renderer as never,
      backendCaller,
      guardrails: over.guardrails ?? guardrails,
      onTurnDropped: over.onTurnDropped,
      turnLog,
      hasOutstandingSpeech: () => false,
      addressedChain: createDefaultAddressedChain(),
      logger,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      pacer,
      appendSkipRecord,
    });
  }

  it("drops a proactive turn that reaches the gate while the pacer holds", async () => {
    const pacer = fakePacer(true);
    const appendSkipRecord = vi.fn();
    const onTurnDropped = vi.fn();
    const d = build(pacer, appendSkipRecord, { onTurnDropped });
    d.start();

    const trigger = proactiveEnv();
    bus.push(trigger);
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).not.toHaveBeenCalled();
    expect(d.inFlight()).toBeNull();
    expect(d.recentDrops().at(-1)).toMatchObject({
      event_name: "proactive.screen_app_switched",
      reason: "global_gap",
    });
    expect(onTurnDropped).toHaveBeenCalledWith(trigger, "global_gap");
    expect(appendSkipRecord).toHaveBeenCalledWith({
      type: "skip",
      source: "dispatcher",
      ts: NOW,
      reason: "global_gap",
      event_name: "proactive.screen_app_switched",
    });
    d.stop();
  });

  it("drops a loop cue from the timer scheduler while the pacer holds", async () => {
    const pacer = fakePacer(true);
    const d = build(pacer, vi.fn());
    d.start();

    bus.push(loopCueEnv());
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).not.toHaveBeenCalled();
    expect(d.recentDrops().at(-1)).toMatchObject({
      event_name: "proactive.cowork",
      reason: "global_gap",
    });
    // Held before the routing log — a candidate that never went out is not a fire.
    expect(logger.info).not.toHaveBeenCalledWith("fire", expect.anything());
    expect(d.queue()).toEqual([]);
    d.stop();
  });

  // A gesture cue is the user's own physical interaction — the gap is about YUI speaking up
  // on her own, so it never applies to one.
  it("lets a gesture cue through while the pacer holds, and re-anchors on it", async () => {
    const pacer = fakePacer(true);
    const appendSkipRecord = vi.fn();
    const d = build(pacer, appendSkipRecord);
    d.start();

    bus.push(gestureEnv());
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(pacer.noteTurnStart).toHaveBeenCalledOnce();
    expect(appendSkipRecord).not.toHaveBeenCalled();
    expect(d.recentDrops()).toEqual([]);
    d.stop();
  });

  // evaluate() consumes a rate-limit slot at fire time and never refunds it, so a held fire
  // that reaches the guardrail spends a cap it never used — and exhausting the overall cap
  // additionally trips a cooldown that silences everything after it.
  it("spends no guardrail slot on a held fire, so a later turn still passes the cap", async () => {
    const cfg = permissiveGuardrailsConfig();
    cfg.rate_limit.tier2_max = 3;
    cfg.rate_limit.overall_max = 3;
    const capped = createGuardrails(cfg, { now: () => Date.now() });
    const pacer = fakePacer(true);
    const d = build(pacer, vi.fn(), { guardrails: capped });
    d.start();

    for (let i = 0; i < 3; i++) {
      bus.push(loopCueEnv({ ts: NOW + i }));
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(backendCaller.call).not.toHaveBeenCalled();

    pacer.open();
    bus.push(loopCueEnv({ ts: NOW + 10 }));
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(d.state()).toBe("running");
    d.stop();
  });

  it("lets a user turn through while the pacer holds, and re-anchors on it", async () => {
    const pacer = fakePacer(true);
    const d = build(pacer, vi.fn());
    d.start();

    bus.push(env());
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(pacer.noteTurnStart).toHaveBeenCalledOnce();
    d.stop();
  });

  it("passes a proactive turn once the window has opened, re-anchoring on it", async () => {
    const pacer = fakePacer(false);
    const d = build(pacer, vi.fn());
    d.start();

    bus.push(proactiveEnv());
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(pacer.noteTurnStart).toHaveBeenCalledOnce();
    d.stop();
  });

  // A candidate arriving mid-turn is held at the routing gate, so it never reaches the deferral
  // queue — the live turn finishes and frees its slot with nothing waiting behind it.
  it("holds a paced candidate that arrives during a live turn instead of deferring it", async () => {
    const pacer = fakePacer(false);
    const appendSkipRecord = vi.fn();
    const d = build(pacer, appendSkipRecord);
    const busyEdges: boolean[] = [];
    d.subscribeBusy((busy) => busyEdges.push(busy));
    d.start();

    bus.push(env({ ts: NOW }));
    await vi.advanceTimersByTimeAsync(20);
    expect(d.inFlight()).not.toBeNull();

    // The user turn anchored the window, so this candidate is dropped where it is routed.
    bus.push(proactiveEnv({ ts: NOW + 1 }));
    await vi.advanceTimersByTimeAsync(20);
    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    expect(d.inFlight()).toBeNull();
    expect(d.queue()).toEqual([]);
    expect(busyEdges).toEqual([true, false]);
    expect(d.recentDrops().at(-1)).toMatchObject({ reason: "global_gap" });
    expect(appendSkipRecord).toHaveBeenCalledOnce();
    d.stop();
  });

  it("swallows a throwing appendSkipRecord — the drop path still records the drop", async () => {
    const pacer = fakePacer(true);
    const d = build(
      pacer,
      vi.fn(() => {
        throw new Error("disk full");
      }),
    );
    d.start();

    bus.push(proactiveEnv());
    await vi.advanceTimersByTimeAsync(20);

    expect(d.recentDrops().at(-1)).toMatchObject({ reason: "global_gap" });
    expect(backendCaller.call).not.toHaveBeenCalled();
    d.stop();
  });
});

describe("dispatcher — urgent signals guardrails (urgent_max)", () => {
  const urgentEnv = (over: Partial<BusEnvelope> = {}): BusEnvelope =>
    env({
      source: "urgent_signal_source",
      event_name: "signals.urgent",
      dnd_override: false,
      ...over,
    });

  function makeUrgentGated(): { d: Dispatcher; g: Guardrails } {
    const cfg = realGuardrailsConfig();
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: () => Date.now() });
    const d = createDispatcher({
      bus,
      renderer: renderer as never,
      peekConfig: () => PEEK_CONFIG,
      tapConfig: () => TAP_CONFIG,
      backendCaller,
      guardrails: g,
      turnLog,
      hasOutstandingSpeech: () => false,
      addressedChain: createDefaultAddressedChain(),
      logger,
    });
    return { d, g };
  }

  it("fires an urgent turn while the global cooldown is active", async () => {
    const { d, g } = makeUrgentGated();
    d.start();
    for (let i = 0; i < 21; i++) {
      g.evaluate(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
      );
    }
    expect(g.cooldownActive()).toBe(true);
    await vi.advanceTimersByTimeAsync(20);
    expect(d.state()).toBe("cooldown");

    bus.push(urgentEnv());
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledOnce();
    d.stop();
  });

  it("drains a pending urgent turn at the pending-drain gate during cooldown", async () => {
    const { d, g } = makeUrgentGated();
    d.start();

    bus.push(env({ ts: NOW })); // user turn takes the in-flight slot
    await vi.advanceTimersByTimeAsync(20);
    expect(d.inFlight()).not.toBeNull();

    for (let i = 0; i < 21; i++) {
      g.evaluate(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
      );
    }
    await vi.advanceTimersByTimeAsync(20);
    expect(d.state()).toBe("cooldown");

    bus.push(urgentEnv({ ts: NOW + 100 }));
    await vi.advanceTimersByTimeAsync(20);
    expect(backendCaller.call).toHaveBeenCalledOnce(); // held in pending behind the user turn

    callDeferred[0].resolve("ok");
    await vi.advanceTimersByTimeAsync(20);

    expect(backendCaller.call).toHaveBeenCalledTimes(2);
    d.stop();
  });
});
