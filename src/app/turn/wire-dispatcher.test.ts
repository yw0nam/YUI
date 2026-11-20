import { beforeEach, describe, expect, it, vi } from "vitest";

// The dispatcher, the backend caller, the guardrails and the pacer are faked so each test
// can drive the deps wireDispatcher composes and assert the handle it returns.
const mocks = vi.hoisted(() => ({
  createDispatcher: vi.fn(),
  createBackendCaller: vi.fn(),
  createGuardrails: vi.fn(),
  createProactivePacer: vi.fn(),
}));

vi.mock("../../dispatcher/dispatcher", () => ({ createDispatcher: mocks.createDispatcher }));
vi.mock("../../dispatcher/backend/backend-caller", () => ({
  createBackendCaller: mocks.createBackendCaller,
}));
vi.mock("../../dispatcher/core/guardrails", () => ({ createGuardrails: mocks.createGuardrails }));
vi.mock("../../dispatcher/core/proactive-pacer", () => ({
  createProactivePacer: mocks.createProactivePacer,
}));

import type { EndpointsConfig } from "../../contract";
import type { TurnErrorDetail, TurnFailure } from "../../dispatcher/backend/backend-caller";
import type { Turn } from "../../dispatcher/turn/turn";
import { createAvatarTools } from "../../io/chat/tools/avatar";
import type { ClientTool } from "../../io/chat/tools/client-tools";
import { createActiveHoursSettings } from "../../settings/active-hours/active-hours-settings";
import { createAgentSettings } from "../../settings/backend/agent-settings";
import { createFlagSettings, type PersistedStorage } from "../../settings/persisted-store";
import { createPacerGapStore } from "../../settings/settings-stores";
import { setLocale } from "../../ui/i18n";
import { createWindowActiveHours } from "../active-hours/window-active-hours";
import { wireDispatcher } from "./wire-dispatcher";

function memoryStorage<T>(): PersistedStorage<T> {
  let saved: T | null = null;
  return {
    load: () => saved,
    save: (s) => {
      saved = s;
    },
  };
}

describe("wireDispatcher", () => {
  beforeEach(() => setLocale("en"));

  const setup = (
    windowTools?: ClientTool[],
    endpoints = {} as EndpointsConfig,
    dndSettings = createFlagSettings(false),
    inputOpen = false,
  ) => {
    const registered: Array<() => void> = [];
    const register = vi.fn((teardown: () => void) => {
      registered.push(teardown);
    });

    let dispatcherDeps:
      | {
          peek?: { enter(): Promise<void>; exit(): Promise<void> };
          isDndOn?: () => boolean;
          onTurnAdmitted?: (turn: Turn) => void;
          onTurnFailed?: (turn: Turn, reason: TurnFailure) => void;
          onUserTurnFailed?: (
            reason: TurnFailure,
            source: "text" | "voice",
            detail?: TurnErrorDetail,
          ) => void;
        }
      | undefined;
    const previousTurn = { callFailed: vi.fn() };
    const quotedTurn = { admitted: vi.fn(), failed: vi.fn() };
    const busyUnsubscribe = vi.fn();
    const showVoiceError = vi.fn();
    const showInputError = vi.fn();
    const turnNotice = { show: vi.fn(), clear: vi.fn() };
    const openSettings = vi.fn();
    const dispatcher = {
      stop: vi.fn(),
      subscribeBusy: vi.fn((_cb: (busy: boolean) => void) => busyUnsubscribe),
    };
    const guardrails = { setConfig: vi.fn(), evaluate: vi.fn(), cooldownActive: vi.fn() };
    const pacer = { stop: vi.fn(), noteIntervalChanged: vi.fn() };
    mocks.createDispatcher.mockImplementation((deps: typeof dispatcherDeps) => {
      dispatcherDeps = deps;
      return dispatcher;
    });
    mocks.createBackendCaller.mockReturnValue({ call: vi.fn() });
    mocks.createGuardrails.mockReturnValue(guardrails);
    mocks.createProactivePacer.mockReturnValue(pacer);

    const pacerGapUnsubscribe = vi.fn();
    const guardrailsOverrideDisposer = vi.fn();
    const activeHoursSettings = createActiveHoursSettings({ storage: memoryStorage() });
    const activeHoursGapSettings = createPacerGapStore(memoryStorage());
    const activeHours = createWindowActiveHours({
      activeHoursSettings,
      agentSettings: createAgentSettings({ storage: memoryStorage() }),
      pacerGapSettings: activeHoursGapSettings,
      dndSettings,
    });
    // The teardown test asserts the registered gap unsubscribe by identity.
    const subscribeGap = activeHours.subscribeGap.bind(activeHours);
    activeHours.subscribeGap = (cb) => {
      subscribeGap(cb);
      return pacerGapUnsubscribe;
    };
    const handle = wireDispatcher({
      bus: {} as never,
      renderer: {} as never,
      surfaces: { isInputOpen: () => inputOpen, showInputError, setBusy: vi.fn() } as never,
      reasoning: {} as never,
      getEndpoints: () => endpoints,
      getGuardrails: () => ({}) as never,
      getConfig: () => ({}) as never,
      getSecret: () => Promise.resolve(undefined),
      getFetch: () => Promise.resolve(undefined),
      sessionStore: {} as never,
      onUsage: () => {},
      chatHistoryStore: {} as never,
      signalHistoryStore: {} as never,
      contextHistory: {} as never,
      overheardStore: {} as never,
      relationsStore: {} as never,
      agentSettings: {} as never,
      relationsSwitch: {} as never,
      guardrailsSettings: {
        subscribe: vi.fn(() => guardrailsOverrideDisposer),
      } as never,
      activeHours,
      oneVoiceSettings: { get: () => ({ enabled: false }) } as never,
      screenshotSettings: {} as never,
      screenCapturer: {} as never,
      contextProviders: { getFrontmost: () => undefined },
      voice: { speakFailure: vi.fn() } as never,
      turnLog: {} as never,
      previousTurn: previousTurn as never,
      quotedTurn,
      pushTurns: {} as never,
      pushSocket: null,
      getVocabulary: () => ({
        emotionIds: [],
        motionIds: [],
        emotionText: { mode: "free", table: null },
      }),
      windowTools,
      openSettings,
      showVoiceError,
      turnNotice,
      appendTurnRecord: vi.fn(),
      t: (key: string) => key,
      register,
    });

    return {
      handle,
      dispatcherDeps: dispatcherDeps!,
      registered,
      pacer,
      guardrails,
      dispatcher,
      busyUnsubscribe,
      pacerGapUnsubscribe,
      guardrailsOverrideDisposer,
      previousTurn,
      quotedTurn,
      showVoiceError,
      showInputError,
      turnNotice,
      openSettings,
      activeHoursSettings,
      activeHoursGapSettings,
    };
  };

  it("builds each turn's tools from generate_express and the avatar tools it was given", () => {
    setup(createAvatarTools(() => null));

    const { clientTools } = mocks.createBackendCaller.mock.calls.at(-1)![0];
    expect(
      clientTools()
        .definitions()
        .map((d: { function: { name: string } }) => d.function.name),
    ).toEqual(["generate_express", "body_action", "look"]);
  });

  it.each([
    {},
    {
      chat_base_url: "http://localhost:8642",
      stt_base_url: "",
      tts_base_url: "",
      chat_api: "responses",
      broker_base_url: "http://localhost:3201/mcp",
    } as EndpointsConfig,
  ])("declares generate_express without avatar tools for endpoints %j", (endpoints) => {
    setup(undefined, endpoints as EndpointsConfig);

    const { clientTools } = mocks.createBackendCaller.mock.calls.at(-1)![0];
    expect(
      clientTools()
        .definitions()
        .map((d: { function: { name: string } }) => d.function.name),
    ).toEqual(["generate_express"]);
  });

  // The dispatcher's routing gate holds a self-fired cue while this reads true.
  it("hands the dispatcher the pet window's do-not-disturb, read live", () => {
    const dnd = createFlagSettings(false);
    const s = setup(undefined, {} as EndpointsConfig, dnd);

    expect(s.dispatcherDeps.isDndOn?.()).toBe(false);
    dnd.setEnabled(true);
    expect(s.dispatcherDeps.isDndOn?.()).toBe(true);
  });

  it("holds for an off span while the device switch is off", () => {
    const s = setup();
    s.activeHoursSettings.setSpans([{ start: "00:00", end: "00:00", pace: "off" }]);

    expect(s.dispatcherDeps.isDndOn?.()).toBe(true);
  });

  it("paces the pacer by the pet window's gap and notes each change", () => {
    const s = setup();
    s.activeHoursGapSettings.set(600_000);
    s.activeHoursSettings.setSpans([{ start: "00:00", end: "00:00", pace: "low" }]);
    const { getIntervalMs } = mocks.createProactivePacer.mock.calls.at(-1)![0];

    expect(getIntervalMs()).toBe(1_800_000);

    s.activeHoursSettings.setSpans([{ start: "00:00", end: "00:00", pace: "high" }]);

    expect(getIntervalMs()).toBe(300_000);
    expect(s.pacer.noteIntervalChanged).toHaveBeenCalledTimes(2);
  });

  it("setPeek reaches the dispatcher's peek enter/exit", async () => {
    const s = setup();
    const peek = { enter: vi.fn(async () => {}), exit: vi.fn(async () => {}) };

    // Before the setter the dispatcher's peek calls resolve without a target.
    await s.dispatcherDeps.peek!.enter();
    await s.dispatcherDeps.peek!.exit();
    expect(peek.enter).not.toHaveBeenCalled();
    expect(peek.exit).not.toHaveBeenCalled();

    s.handle.setPeek(peek);
    await s.dispatcherDeps.peek!.enter();
    await s.dispatcherDeps.peek!.exit();
    expect(peek.enter).toHaveBeenCalledTimes(1);
    expect(peek.exit).toHaveBeenCalledTimes(1);
  });

  it("hands the admitted turn to the quoted turn and fans a failure out to both ledgers", () => {
    const s = setup();
    const turn: Turn = {
      id: 7,
      trigger: { source: "user_input_source", event_name: "user.text_submitted", ts: 0 },
    };

    expect(s.dispatcherDeps.onTurnAdmitted).toBe(s.quotedTurn.admitted);
    s.dispatcherDeps.onTurnFailed!(turn, "network_drop");

    expect(s.previousTurn.callFailed).toHaveBeenCalledWith(turn, "network_drop");
    expect(s.quotedTurn.failed).toHaveBeenCalledWith(turn);
  });

  it("shows the server's message on the voice error of a failed voice turn", () => {
    const s = setup();

    s.dispatcherDeps.onUserTurnFailed!("network_drop", "voice", {
      message: "rate limit\nreached",
    });

    expect(s.showVoiceError).toHaveBeenCalledWith("network_drop", "rate limit reached");
  });

  it("shows the status with the server's message on the voice error when the failure has one", () => {
    const s = setup();

    s.dispatcherDeps.onUserTurnFailed!("network_drop", "voice", {
      status: 500,
      message: "internal server error",
    });

    expect(s.showVoiceError).toHaveBeenCalledWith("network_drop", "500 internal server error");
  });

  it("keeps the voice error wording of a failure with no server message", () => {
    const s = setup();

    s.dispatcherDeps.onUserTurnFailed!("network_drop", "voice");

    expect(s.showVoiceError).toHaveBeenCalledWith("network_drop", undefined);
  });

  it.each([
    [
      "http_4xx_drop",
      undefined,
      "Auth failed · check API key",
      { label: "Change key", onClick: expect.any(Function) },
    ],
    [
      "network_drop",
      { status: 400, message: "model does not support tools" },
      "400 model does not support tools",
      { label: "Check connection", onClick: expect.any(Function) },
    ],
    ["network_drop", undefined, "No response · check connection", "retry"],
    ["network_drop", { status: 503, message: "overloaded" }, "503 overloaded", "retry"],
    ["network_stall", undefined, "The connection stopped responding", "retry"],
  ] as const)("offers the %s next step on the open input: %j", (reason, detail, message, offer) => {
    const s = setup(undefined, {} as EndpointsConfig, createFlagSettings(false), true);

    s.dispatcherDeps.onUserTurnFailed!(reason, "text", detail);

    expect(s.showInputError).toHaveBeenCalledExactlyOnceWith(message, offer);
  });

  it("opens Connection from a key action on the open input", () => {
    const s = setup(undefined, {} as EndpointsConfig, createFlagSettings(false), true);
    s.dispatcherDeps.onUserTurnFailed!("http_4xx_drop", "text");

    const offer = s.showInputError.mock.calls[0]![1];
    expect(offer).toEqual({ label: "Change key", onClick: expect.any(Function) });
    offer.onClick();

    expect(s.openSettings).toHaveBeenCalledExactlyOnceWith("conn");
  });

  it.each([
    [
      "voice",
      "http_4xx_drop",
      undefined,
      { message: "Auth failed · check API key", action: { label: "Change key" } },
    ],
    [
      "text",
      "network_drop",
      { status: 400, message: "model does not support tools" },
      { message: "400 model does not support tools", action: { label: "Check connection" } },
    ],
    [
      "voice",
      "not_configured",
      undefined,
      { message: "Not connected yet", action: { label: "Connect" } },
    ],
    ["voice", "network_stall", undefined, { message: "The connection stopped responding" }],
  ] as const)("posts a %s %s failure on the pill when the input is not open: %j", (source, reason, detail, expected) => {
    const s = setup();

    s.dispatcherDeps.onUserTurnFailed!(reason, source, detail);

    expect(s.turnNotice.show).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message: expected.message,
        ...("action" in expected && {
          action: { label: expected.action.label, onClick: expect.any(Function) },
        }),
      }),
    );
    expect(s.showInputError).not.toHaveBeenCalled();
  });

  it("opens Connection from the notice's key action", () => {
    const s = setup();
    s.dispatcherDeps.onUserTurnFailed!("http_4xx_drop", "voice");

    expect(s.turnNotice.show).toHaveBeenCalledOnce();
    const notice = s.turnNotice.show.mock.calls[0]![0];
    expect(notice.action).toEqual({ label: "Change key", onClick: expect.any(Function) });
    notice.action.onClick();

    expect(s.openSettings).toHaveBeenCalledExactlyOnceWith("conn");
  });

  it("keeps a typed failure on the open input and off the pill", () => {
    const s = setup(undefined, {} as EndpointsConfig, createFlagSettings(false), true);

    s.dispatcherDeps.onUserTurnFailed!("http_4xx_drop", "text");

    expect(s.showInputError).toHaveBeenCalledOnce();
    expect(s.turnNotice.show).not.toHaveBeenCalled();
  });

  it("clears the notice when a new turn starts", () => {
    const s = setup();
    const onBusy = s.dispatcher.subscribeBusy.mock.calls[0]![0];

    onBusy(false);
    expect(s.turnNotice.clear).not.toHaveBeenCalled();
    onBusy(true);

    expect(s.turnNotice.clear).toHaveBeenCalledOnce();
  });

  it("registers the teardowns in composition order and they run LIFO", () => {
    const s = setup();

    expect(s.registered).toEqual([
      s.pacer.stop,
      s.pacerGapUnsubscribe,
      s.guardrailsOverrideDisposer,
      expect.any(Function),
      s.busyUnsubscribe,
    ]);

    for (const teardown of [...s.registered].reverse()) teardown();
    expect(s.busyUnsubscribe).toHaveBeenCalledTimes(1);
    expect(s.dispatcher.stop).toHaveBeenCalledTimes(1);
    expect(s.guardrailsOverrideDisposer).toHaveBeenCalledTimes(1);
    expect(s.pacerGapUnsubscribe).toHaveBeenCalledTimes(1);
    expect(s.pacer.stop).toHaveBeenCalledTimes(1);
  });
});
