// @vitest-environment jsdom
/** The gesture drain wiring: a tap-bored turn carries no held signals while DND is on. */
import { afterEach, expect, it, vi } from "vitest";
import type { AppConfig } from "../config/load";
import { avatarFixture, guardrailsFixture, personaFixture } from "../config/load-test-helpers";
import { createEventBus } from "../dispatcher/core/event-bus";
import type { OsEventListen, OsEventPayload } from "../io/window/tauri-listen";
import { createFlagSettings } from "../settings/persisted-store";
import { createSettingsStores } from "../settings/settings-stores";
import { createConfiguredBootstrap } from "./bootstrap-configured";

// The fake Tauri channel the real signals source subscribes to; the gesture wiring captures its
// drainSignals dep so the test can drive the DND gate the bootstrap lambda applies.
const hoisted = vi.hoisted(() => {
  const handlers = new Map<string, Set<(e: { payload: OsEventPayload }) => void>>();
  const gesture: { drainSignals?: () => unknown[] } = {};
  return {
    gesture,
    channel: {
      listen: (async (event: string, handler: (e: { payload: OsEventPayload }) => void) => {
        let set = handlers.get(event);
        if (!set) {
          set = new Set();
          handlers.set(event, set);
        }
        set.add(handler);
        return () => {
          set.delete(handler);
        };
      }) as OsEventListen,
      emit: (event: string, payload: unknown) => {
        for (const h of handlers.get(event) ?? []) h({ payload: payload as OsEventPayload });
      },
      reset: () => handlers.clear(),
    },
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => 0) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("../io/window/tauri-listen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../io/window/tauri-listen")>();
  return { ...actual, resolveTauriListen: async () => hoisted.channel.listen };
});
vi.mock("./turn/turn-core", () => ({
  wireTurnCore: vi.fn(async () => ({
    voice: {
      turnOutput: { speak: vi.fn() },
      onUtteranceEnd: () => () => {},
      onSynthFailure: () => () => {},
      onTtsReach: () => () => {},
      onUtteranceStart: () => () => {},
      reconnectTts: vi.fn(),
    },
    dispatcher: {
      subscribeBusy: () => () => {},
      isPipelineBusy: () => false,
      subscribePipelineBusy: () => () => {},
    },
    guardrails: {},
    pacer: { isHolding: () => false, subscribe: () => () => {}, noteTurnStart: () => {}, stop: () => {} },
    setPeek: () => {},
    setProactiveSource: () => {},
    setStrolling: () => {},
    start: () => {},
    connect: async () => ({
      vocabulary: { vocabulary: () => ({}), dispose: () => {}, subscribe: () => () => {} },
      stopTurn: () => [],
    }),
  })),
}));
vi.mock("./stage/wire-locomotion", () => ({
  wireLocomotion: () => ({
    walker: { isStrolling: () => false },
    sitter: { sitDown: vi.fn() },
    getAvatarExecutor: () => null,
    armedSit: () => null,
    frame: { frameWindow: () => null, listMonitors: async () => [] },
  }),
}));
vi.mock("./stage/wire-gestures", () => ({
  wireStageGestures: vi.fn(async (deps: { drainSignals: () => unknown[] }) => {
    hoisted.gesture.drainSignals = deps.drainSignals;
  }),
}));
vi.mock("./stage/wire-summon", () => ({
  wirePeek: async () => null,
  wireSummonHotkey: () => ({ apply: async () => {}, current: () => null, dispose: async () => {} }),
}));
vi.mock("./signal-chips/wire-signal-chips", () => ({
  wireSignalChips: () => ({ onArrival: () => {}, collapsed: { dispose: () => {} } }),
}));
vi.mock("./stage/wire-stage", () => ({ wireHitTest: () => ({ stop: () => {} }), wireGaze: () => {} }));
vi.mock("./stage/wire-window-geometry", () => ({ wireWindowGeometry: async () => null }));
vi.mock("./turn/wire-thread-turns", () => ({ wireThreadTurns: () => () => {} }));
vi.mock("./turn/wire-greeting", () => ({
  wireGreeting: () => ({ dispose: () => {}, greetLocal: () => {} }),
}));
vi.mock("./turn/wire-first-conversation", () => ({ wireFirstConversation: () => ({ dispose: () => {} }) }));
vi.mock("./turn/voice/wire-synth-failure-notice", () => ({
  wireSynthFailureNotice: () => ({ dispose: () => {} }),
}));
vi.mock("./turn/voice/wire-tts-unreachable-notice", () => ({
  wireTtsUnreachableNotice: () => ({ dispose: () => {} }),
}));
vi.mock("../ui/notices/ingress-dead-notice", () => ({ wireIngressDeadNotice: () => () => {} }));

function validConfig(): AppConfig {
  return {
    endpoints: {
      chat_base_url: "http://chat.test/v1",
      stt_base_url: "http://stt.test/v1",
      tts_base_url: "http://tts.test/v1",
    },
    avatar: {
      ...avatarFixture(),
      vrm_url: "/vrms/test.vrm",
      available: [{ id: "test", label: "Test", url: "/vrms/test.vrm" }],
      walk: {
        interval_min_ms: 60_000,
        interval_max_ms: 180_000,
        distance_min_px: 80,
        distance_max_px: 320,
        floor_tolerance_px: 8,
      },
      fall: {
        gravity_px_s2: 2400,
        max_speed_px_s: 1800,
        min_drop_frac: 0.2,
        cue_cooldown_ms: 60_000,
        land_room_frac: 0.5,
        step_off_probability: 0.1,
      },
    },
    emotionRegistry: {},
    motions: {},
    guardrails: {
      debounce_ms: { os_event_watcher: 0, user_input_source: 0, screen_watcher: 5000 },
      rate_limit: {
        window_ms: 60_000,
        tier2_max: 10,
        urgent_max: 120,
        overall_max: 20,
        cooldown_ms: 30_000,
        addressed_chain_max: 2,
      },
      attachments: guardrailsFixture().attachments,
    },
    filler: {
      gap_ms: 1_000,
      gap_jitter_ms: 100,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: {},
    },
    hotkeys: { summon_global: "CmdOrCtrl+Shift+Y" },
    screen: {
      prev_dwell_ms: 600000,
      settle_ms: 90000,
      long_session_ms: 2700000,
      min_gap_ms: 300000,
      quiet_after_turn_ms: 180000,
      recent_cap: 5,
    },
    persona: personaFixture(),
  };
}

const ENVELOPE = {
  source: "n8n",
  event_type: "workflow_done",
  delivery: "batched" as const,
  event_id: "run-8812",
  occurred_at: 1_787_449_000_000,
};

afterEach(() => {
  hoisted.channel.reset();
  hoisted.gesture.drainSignals = undefined;
});

it("a tap-bored drain carries no signals while DND is on, and the buffer still holds them for the catch-up", async () => {
  const cfg = validConfig();
  const settings = { ...createSettingsStores(), dndSettings: createFlagSettings(false) };
  // The first-run hint is already seen, so the bootstrap skips it; signals ingress is on.
  settings.hintSettings.setEnabled(true);
  settings.agentNotifySettings.setEnabled(true);
  const phase1 = {
    bound: true,
    config: { get: () => cfg },
    renderer: {},
    surfaces: {},
    settings,
    conversation: { relationsStore: {}, chatHistoryStore: {}, signalHistoryStore: {} },
    bus: createEventBus(),
    userInput: { submit: vi.fn() },
    vrm: { vrmSelection: {} },
    threads: null,
    screenCapturer: {},
    openSettings: vi.fn(),
    emitCharacterAddressed: vi.fn(),
    onCharacterAddressed: () => () => {},
    onUserTurnRouted: () => () => {},
    getEndpoints: () => cfg.endpoints,
    isDisposed: () => false,
  };
  const configured = await createConfiguredBootstrap(cfg, phase1 as never);
  // Let the fire-and-forget source starts subscribe to the fake channel.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  hoisted.channel.emit("signals-inbox", { signals: [{ id: 1 }], ts: 1, envelope: ENVELOPE });
  const drain = hoisted.gesture.drainSignals!;

  settings.dndSettings.setEnabled(true);
  expect(drain()).toEqual([]);

  // The gated drain left the group buffered; turning DND off hands it back for the catch-up.
  settings.dndSettings.setEnabled(false);
  expect(drain()).toEqual([{ envelope: ENVELOPE, items: [{ id: 1 }] }]);

  configured.dispose();
});