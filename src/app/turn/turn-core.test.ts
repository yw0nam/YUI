import { describe, expect, it, vi } from "vitest";

const { dispatcher, dispatcherDeps, endThinking, pushTurns, speechPlayback } = vi.hoisted(() => ({
  dispatcher: { cancel: vi.fn(), start: vi.fn() },
  dispatcherDeps: [] as Array<{ isBodyHeld?: () => boolean }>,
  endThinking: vi.fn(),
  pushTurns: { cut: vi.fn(() => ["t1"]) },
  speechPlayback: { interrupt: vi.fn() },
}));

const { createSttEngine, voiceDeps } = vi.hoisted(() => ({
  createSttEngine: vi.fn(async () => ({})),
  voiceDeps: [] as Array<Parameters<typeof import("./voice/wire-voice").wireTurnVoice>[0]>,
}));

vi.mock("./voice/wire-voice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./voice/wire-voice")>();
  type TurnVoice = ReturnType<typeof actual.wireTurnVoice>;
  return {
    ...actual,
    wireTurnVoice: (deps: (typeof voiceDeps)[number]): TurnVoice => {
      voiceDeps.push(deps);
      return {
        voice: {
          speechPlayback: speechPlayback as unknown as TurnVoice["voice"]["speechPlayback"],
          turnOutput: {} as TurnVoice["voice"]["turnOutput"],
          speakFailure: () => {},
          resumeThinking: () => {},
          endThinking,
          createSttEngine: createSttEngine as unknown as TurnVoice["voice"]["createSttEngine"],
          dispose: () => {},
        },
        voiceInput: { setStt: () => {} } as unknown as TurnVoice["voiceInput"],
        voiceErrorDwell: { show: () => {} } as unknown as TurnVoice["voiceErrorDwell"],
        turnLog: {} as TurnVoice["turnLog"],
        previousTurn: {} as TurnVoice["previousTurn"],
        quotedTurn: {} as TurnVoice["quotedTurn"],
        pushTurns: pushTurns as unknown as TurnVoice["pushTurns"],
        setProactiveSource: () => {},
        setStrolling: () => {},
      };
    },
  };
});
vi.mock("./broker/wire-broker", () => ({ wireBroker: async () => ({ dispose: () => {} }) }));
vi.mock("./vocabulary/wire-vocabulary", () => ({
  wireVocabulary: async () => ({
    vocabulary: () => ({}),
    subscribe: () => () => {},
    dispose: () => {},
  }),
}));
vi.mock("./wire-dispatcher", () => ({
  wireDispatcher: (deps: { isBodyHeld?: () => boolean }) => {
    dispatcherDeps.push(deps);
    return { dispatcher, setPeek: () => {} };
  },
}));
vi.mock("../settings/wire-avatar", () => ({ applyAvatarConfig: () => {} }));
vi.mock("./push/playback", () => ({ wirePlayback: () => () => {} }));
vi.mock("./push/wire-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./push/wire-push")>()),
  wirePushTransport: () => () => {},
}));

import { createBedSceneHold } from "../stage/bed-scene-hold";
import { type TurnCorePhase1, wireTurnCore } from "./turn-core";

function wire(over: Partial<TurnCorePhase1> = {}) {
  let onStop: () => void = () => {};
  let onStopTurns: () => void = () => {};
  const teardowns: Array<() => void> = [];
  const phase1 = {
    config: { get: () => ({}) },
    surfaces: { onStop: (cb: () => void) => (onStop = cb), onSubmit: () => {} },
    onStopTurns: (cb: () => void) => {
      onStopTurns = cb;
      return () => {};
    },
    settings: {},
    conversation: {},
    vrm: {
      vrmSelection: { getActive: () => ({ url: "/a.vrm" }) },
      loadVrmSerialized: async () => {},
    },
    speaker: { migrateVoiceIds: async () => {}, refreshVoiceList: () => {} },
    ...over,
  } as unknown as TurnCorePhase1;
  const core = wireTurnCore({} as never, phase1, {
    getFrontmost: () => undefined,
    screenCapturer: {} as never,
    openSettings: () => {},
    register: (teardown) => teardowns.push(teardown),
    ensureActive: () => {},
  });
  return { core, teardowns, stop: () => onStop(), stopFromUnified: () => onStopTurns() };
}

describe("wireTurnCore", () => {
  it("stops the turn from the stop button: cancels, cuts the push turns and interrupts the speech", async () => {
    const h = wire();
    const core = await h.core;
    const onStop = h.stop;

    const { stopTurn } = await core.connect({ onSubmit: () => {} });
    onStop();

    expect(dispatcher.cancel).toHaveBeenCalledOnce();
    expect(speechPlayback.interrupt).toHaveBeenCalledOnce();
    expect(stopTurn()).toEqual(["t1"]);
  });

  it("stops the turn the same way when the unified window asks every window to stop", async () => {
    const h = wire();
    const core = await h.core;
    await core.connect({ onSubmit: () => {} });
    dispatcher.cancel.mockClear();
    speechPlayback.interrupt.mockClear();

    h.stopFromUnified();

    expect(dispatcher.cancel).toHaveBeenCalledOnce();
    expect(speechPlayback.interrupt).toHaveBeenCalledOnce();
  });

  it("sends speech to the unified window while it shows, and a speech onset only tells that window, without stopping here", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const emitVoiceSegment = vi.fn();
    const emitSpeechOnset = vi.fn();
    const h = wire({
      unifiedShown: { get: () => true },
      emitVoiceSegment,
      emitSpeechOnset,
      userInput: { submitVoice: () => {} } as never,
      settings: { vadSettings: { get: () => ({ bargeIn: true }) } } as never,
    });
    const core = await h.core;
    await core.connect({ onSubmit: () => {} });
    const voice = voiceDeps.at(-1)!;

    voice.submitVoice("hi");
    voice.onVoiceTurnStart?.();

    expect(emitVoiceSegment).toHaveBeenCalledExactlyOnceWith({ text: "hi" });
    expect(emitSpeechOnset).toHaveBeenCalledOnce();
    expect(dispatcher.cancel).not.toHaveBeenCalled();
    expect(pushTurns.cut).not.toHaveBeenCalled();
    expect(speechPlayback.interrupt).not.toHaveBeenCalled();
  });

  it("sends the backend no stop when the unified window's stop reaches a window with nothing running", async () => {
    pushTurns.cut.mockReturnValueOnce([]);
    const sendStop = vi.fn(() => true);
    const h = wire({ pushSocket: { sendStop, sendVocabulary: () => {} } as never });
    const core = await h.core;
    await core.connect({ onSubmit: () => {} });

    h.stopFromUnified();

    expect(sendStop).not.toHaveBeenCalled();
  });

  it("gives the dispatcher the body hold, and ends the thinking bridge each time the hold is taken", async () => {
    const bedSceneHold = createBedSceneHold();
    const h = wire({ bedSceneHold });
    await h.core;

    expect(dispatcherDeps.at(-1)?.isBodyHeld).toBe(bedSceneHold.isHeld);
    expect(endThinking).not.toHaveBeenCalled();
    bedSceneHold.take();
    expect(endThinking).toHaveBeenCalledOnce();

    bedSceneHold.release();
    for (const teardown of h.teardowns) teardown();
    bedSceneHold.take();
    expect(endThinking).toHaveBeenCalledOnce();
  });

  it("does not create an STT engine in a bound pet", async () => {
    await wire({ bound: true }).core;
    expect(createSttEngine).not.toHaveBeenCalled();
  });
});
