import { describe, expect, it, vi } from "vitest";

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

import { wireDispatcher } from "./wire-dispatcher";

describe("wireDispatcher", () => {
  const setup = () => {
    const registered: Array<() => void> = [];
    const register = vi.fn((teardown: () => void) => {
      registered.push(teardown);
    });

    let dispatcherDeps: { peek?: { enter(): Promise<void>; exit(): Promise<void> } } | undefined;
    const busyUnsubscribe = vi.fn();
    const dispatcher = {
      stop: vi.fn(),
      subscribeBusy: vi.fn(() => busyUnsubscribe),
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
    const handle = wireDispatcher({
      bus: {} as never,
      renderer: {} as never,
      surfaces: {} as never,
      reasoning: {} as never,
      getEndpoints: () => ({}) as never,
      getGuardrails: () => ({}) as never,
      getConfig: () => ({}) as never,
      getSecret: () => Promise.resolve(undefined),
      getFetch: () => Promise.resolve(undefined),
      sessionStore: {} as never,
      sessionDiagnostics: {} as never,
      chatHistoryStore: {} as never,
      contextHistory: {} as never,
      agentSettings: {} as never,
      guardrailsSettings: {
        subscribe: vi.fn(() => guardrailsOverrideDisposer),
      } as never,
      pacerGapSettings: {
        get: () => ({ value: 0 }),
        subscribe: vi.fn(() => pacerGapUnsubscribe),
      } as never,
      screenshotSettings: {} as never,
      screenCapturer: {} as never,
      getFrontmost: () => undefined,
      voice: {} as never,
      turnLog: {} as never,
      previousTurn: {} as never,
      pushTurns: {} as never,
      pushSocket: null,
      getVocabulary: () => ({}) as never,
      openQuickControls: vi.fn(),
      showVoiceError: vi.fn(),
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
    };
  };

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
