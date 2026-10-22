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

import type { TurnErrorDetail, TurnFailure } from "../../dispatcher/backend/backend-caller";
import type { Turn } from "../../dispatcher/turn/turn";
import { createAvatarTools } from "../../io/chat/tools/avatar";
import type { ClientTool } from "../../io/chat/tools/client-tools";
import { wireDispatcher } from "./wire-dispatcher";

describe("wireDispatcher", () => {
  const setup = (isBodyHeld?: () => boolean, windowTools?: ClientTool[]) => {
    const registered: Array<() => void> = [];
    const register = vi.fn((teardown: () => void) => {
      registered.push(teardown);
    });

    let dispatcherDeps:
      | {
          peek?: { enter(): Promise<void>; exit(): Promise<void> };
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
      surfaces: { isInputOpen: () => false } as never,
      reasoning: {} as never,
      getEndpoints: () => ({}) as never,
      getGuardrails: () => ({}) as never,
      getConfig: () => ({}) as never,
      getSecret: () => Promise.resolve(undefined),
      getFetch: () => Promise.resolve(undefined),
      sessionStore: {} as never,
      onUsage: () => {},
      chatHistoryStore: {} as never,
      contextHistory: {} as never,
      overheardStore: {} as never,
      relationsStore: {} as never,
      agentSettings: {} as never,
      guardrailsSettings: {
        subscribe: vi.fn(() => guardrailsOverrideDisposer),
      } as never,
      pacerGapSettings: {
        get: () => ({ value: 0 }),
        subscribe: vi.fn(() => pacerGapUnsubscribe),
      } as never,
      oneVoiceSettings: { get: () => ({ enabled: false }) } as never,
      screenshotSettings: {} as never,
      screenCapturer: {} as never,
      getFrontmost: () => undefined,
      isBodyHeld,
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
      openQuickControls: vi.fn(),
      showVoiceError,
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
    };
  };

  it("builds each turn's tools from generate_express and the avatar tools it was given", () => {
    setup(
      undefined,
      createAvatarTools(() => null),
    );

    const { clientTools } = mocks.createBackendCaller.mock.calls.at(-1)![0];
    expect(
      clientTools()
        .definitions()
        .map((d: { function: { name: string } }) => d.function.name),
    ).toEqual(["generate_express", "body_action", "look"]);
  });

  it("builds each turn's tools from generate_express alone when given no avatar tools", () => {
    setup();

    const { clientTools } = mocks.createBackendCaller.mock.calls.at(-1)![0];
    expect(
      clientTools()
        .definitions()
        .map((d: { function: { name: string } }) => d.function.name),
    ).toEqual(["generate_express"]);
  });

  it("hands the caller the scene hold, so no turn starts a thinking bridge on the bed", () => {
    const held = () => true;
    setup(held);

    expect(mocks.createBackendCaller.mock.calls.at(-1)?.[0].isBodyHeld).toBe(held);
  });

  it("builds the caller without a scene hold where there is no bed", () => {
    setup();

    expect(mocks.createBackendCaller.mock.calls.at(-1)?.[0].isBodyHeld).toBeUndefined();
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
