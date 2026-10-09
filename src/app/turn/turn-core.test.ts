import { describe, expect, it, vi } from "vitest";

const { dispatcher, dispatcherDeps, endThinking, pushTurns, speechPlayback } = vi.hoisted(() => ({
  dispatcher: { cancel: vi.fn(), start: vi.fn() },
  dispatcherDeps: [] as Array<{ isBodyHeld?: () => boolean }>,
  endThinking: vi.fn(),
  pushTurns: { cut: vi.fn(() => ["t1"]) },
  speechPlayback: { interrupt: vi.fn() },
}));

vi.mock("./voice/wire-voice", () => ({
  wireTurnVoice: () => ({
    voice: { speechPlayback, endThinking, createSttEngine: async () => ({}) },
    voiceInput: { setStt: () => {} },
    voiceErrorDwell: { show: () => {} },
    pushTurns,
    quotedTurn: {},
    setProactiveSource: () => {},
    setStrolling: () => {},
  }),
}));
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

import { createBedSceneHold } from "../stage/bed-scene-hold";
import { type TurnCorePhase1, wireTurnCore } from "./turn-core";

function wire(over: Partial<TurnCorePhase1> = {}) {
  let onStop: () => void = () => {};
  const teardowns: Array<() => void> = [];
  const phase1 = {
    config: { get: () => ({}) },
    surfaces: { onStop: (cb: () => void) => (onStop = cb), onSubmit: () => {} },
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
    openQuickControls: () => {},
    register: (teardown) => teardowns.push(teardown),
    ensureActive: () => {},
  });
  return { core, teardowns, stop: () => onStop() };
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
});
