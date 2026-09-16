/**
 * dispatcher.cooldown.test.ts — §6.3/§9 cooldown state mirror.
 *
 * Scope:
 *  - Overall-cap overflow flips dispatcher.state() to 'cooldown' and back to 'running' once the
 *    guardrails' own cooldown window elapses; tier1 events keep rendering throughout.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/load";
import type { Logger } from "../logger";
import type { BackendCaller } from "./backend-caller";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { createEventBus, type EventBus } from "./event-bus";
import { createGuardrails, type Guardrails } from "./guardrails";
import {
  type DeferredCall,
  env,
  makeDeferredBackendCaller,
  makeLogger,
  NOW,
  permissiveGuardrailsConfig,
  realGuardrailsConfig,
} from "./test-helpers";
import { createTurnLog, type TurnLog } from "./turn";

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
    peek: { enter: peekEnter, exit: peekExit },
    logger,
    peekConfig: () => PEEK_CONFIG,
    tapConfig: () => TAP_CONFIG,
  };
  dispatcher = createDispatcher(deps);
});
afterEach(() => {
  dispatcher.stop();
  vi.useRealTimers();
});

describe("dispatcher — cooldown state mirror (§6.3/§9)", () => {
  it("overall-cap overflow flips state() to 'cooldown' and back to 'running'; tier1 still renders", async () => {
    const cfg = realGuardrailsConfig();
    cfg.rate_limit.tier2_max = 1000; // make overall cap the binding constraint
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
      logger,
    });
    d.start();

    // 21 non-override tier2 user firings → 21st enters cooldown.
    for (let i = 0; i < 21; i++) {
      bus.push(
        env({
          source: "user_input_source",
          event_name: "user.text_submitted",
          ts: NOW + i,
          dnd_override: false,
        }),
      );
      await vi.advanceTimersByTimeAsync(20);
      // resolve any in-flight so the next can start.
      callDeferred[callDeferred.length - 1]?.resolve("ok");
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(g.cooldownActive()).toBe(true);
    expect(d.state()).toBe("cooldown");

    // tier1 still renders during cooldown.
    applyDirective.mockClear();
    bus.push(
      env({
        source: "user_input_source",
        event_name: "user.drag_start",
        ts: NOW + 100,
        hint_tier: 1,
        dnd_override: false,
      }),
    );
    await vi.advanceTimersByTimeAsync(20);
    expect(applyDirective).toHaveBeenCalled();

    // after 5min the dispatcher auto-returns to running.
    vi.setSystemTime(NOW + 21 + 300_000 + 1000);
    await vi.advanceTimersByTimeAsync(20);
    expect(g.cooldownActive()).toBe(false);
    expect(d.state()).toBe("running");
    d.stop();
  });
});
