/**
 * dispatcher.push.test.ts — a push turn reads as running for as long as the backend works.
 *
 * The real dispatcher over the real backend caller in push mode. The busy edge the composer and
 * the message plate follow is the backend call being open, and in push mode the call is open from
 * the frame going out to the turn's turn_end.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PeekConfig, TapConfig } from "../config/load";
import { guardrailsFixture } from "../config/load-test-helpers";
import type { EndpointsConfig } from "../contract";
import { createBackendCaller } from "./backend/backend-caller";
import { type BusEnvelope, createEventBus, type EventBus } from "./core/event-bus";
import { createGuardrails } from "./core/guardrails";
import { createDispatcher, type Dispatcher } from "./dispatcher";
import { CONFIG, makeLogger, makeTurnOutput, userEnv } from "./test-helpers";
import { createPushTurns, type PushTurns } from "./turn/push-turn";
import { createTurnLog } from "./turn/turn";

const PUSH_CONFIG: EndpointsConfig = { ...CONFIG, chat_api: "push" };

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
let dispatcher: Dispatcher;
let pushTurns: PushTurns;
let sentIds: string[];
let busyEdges: boolean[];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_717_000_000_000);
  bus = createEventBus();
  pushTurns = createPushTurns();
  sentIds = [];
  busyEdges = [];
  const backendCaller = createBackendCaller({
    config: PUSH_CONFIG,
    renderer: { applyDirective: vi.fn() } as never,
    getApiKey: async () => "k",
    getFetch: async () => undefined,
    turnOutput: makeTurnOutput(),
    pushTurn: (frame) => {
      sentIds.push(frame.turn_id);
      return true;
    },
    onPushTurnSent: (turnId) => pushTurns.opened(turnId),
    onPushTurnCut: () => pushTurns.cut(),
    pushTurns,
    onPushSocketNotReady: () => () => {},
    logger: makeLogger(),
  });
  dispatcher = createDispatcher({
    bus,
    renderer: {
      applyDirective: vi.fn(),
      setPerchTarget: vi.fn(),
      setPeekTarget: vi.fn(),
      setMotionMirror: vi.fn(),
      easeEmotionToNeutral: vi.fn(),
    } as never,
    backendCaller,
    guardrails: createGuardrails({
      debounce_ms: { os_event_watcher: 0, user_input_source: 0, screen_watcher: 5_000 },
      rate_limit: {
        window_ms: 3_600_000,
        tier2_max: 1000,
        tier3_max: 1000,
        overall_max: 1000,
        cooldown_ms: 300_000,
      },
      attachments: guardrailsFixture().attachments,
    }),
    turnLog: createTurnLog(),
    hasOutstandingSpeech: () => false,
    peekConfig: () => PEEK_CONFIG,
    tapConfig: () => TAP_CONFIG,
    logger: makeLogger(),
  });
  dispatcher.subscribeBusy((busy) => busyEdges.push(busy));
});

afterEach(() => {
  dispatcher.stop();
  vi.useRealTimers();
});

describe("dispatcher — a push turn in flight", () => {
  it("stays busy from the frame going out to the turn's turn_end", async () => {
    dispatcher.start();
    bus.push(userEnv() as BusEnvelope);
    await vi.advanceTimersByTimeAsync(20);

    expect(sentIds).toHaveLength(1);
    expect(busyEdges).toEqual([true]);

    pushTurns.rendered(sentIds[0]!);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(busyEdges).toEqual([true]);
    expect(dispatcher.inFlight()).not.toBeNull();

    pushTurns.ended(sentIds[0]!);
    await vi.advanceTimersByTimeAsync(20);

    expect(busyEdges).toEqual([true, false]);
    expect(dispatcher.inFlight()).toBeNull();
  });
});
