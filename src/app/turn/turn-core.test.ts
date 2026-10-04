import { describe, expect, it, vi } from "vitest";

const { dispatcher, pushTurns, speechPlayback } = vi.hoisted(() => ({
  dispatcher: { cancel: vi.fn(), start: vi.fn() },
  pushTurns: { cut: vi.fn(() => ["t1"]) },
  speechPlayback: { interrupt: vi.fn() },
}));

vi.mock("./voice/wire-voice", () => ({
  wireTurnVoice: () => ({
    voice: { speechPlayback, createSttEngine: async () => ({}) },
    voiceInput: { setStt: () => {} },
    voiceErrorDwell: { show: () => {} },
    pushTurns,
    quotedTurn: {},
    setProactiveSource: () => {},
    setStrolling: () => {},
  }),
}));
vi.mock("./broker/wire-broker", () => ({
  wireBroker: async () => ({ vocabulary: () => ({}), dispose: () => {} }),
}));
vi.mock("./wire-dispatcher", () => ({
  wireDispatcher: () => ({ dispatcher, setPeek: () => {} }),
}));
vi.mock("../settings/wire-avatar", () => ({ applyAvatarConfig: () => {} }));

import { type TurnCorePhase1, wireTurnCore } from "./turn-core";

describe("wireTurnCore", () => {
  it("stops the turn from the stop button: cancels, cuts the push turns and interrupts the speech", async () => {
    let onStop: () => void = () => {};
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
    } as unknown as TurnCorePhase1;
    const core = await wireTurnCore({} as never, phase1, {
      getFrontmost: () => undefined,
      screenCapturer: {} as never,
      openQuickControls: () => {},
      register: () => {},
      ensureActive: () => {},
    });

    const { stopTurn } = await core.connect({ onSubmit: () => {} });
    onStop();

    expect(dispatcher.cancel).toHaveBeenCalledOnce();
    expect(speechPlayback.interrupt).toHaveBeenCalledOnce();
    expect(stopTurn()).toEqual(["t1"]);
  });
});
