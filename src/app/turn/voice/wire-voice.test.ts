import { beforeEach, describe, expect, it, vi } from "vitest";

// wireVoicePipeline is faked so tests can drive the deps wireTurnVoice hands it.
const { wireVoicePipeline } = vi.hoisted(() => ({ wireVoicePipeline: vi.fn() }));

vi.mock("./wire-voice-pipeline", () => ({ wireVoicePipeline }));

import { createVoiceInputStatus } from "../../../ui/chips/voice-input-status";
import { wireTurnVoice, wireVoiceInput } from "./wire-voice";

describe("wireVoiceInput", () => {
  // Real voiceInputStatus store for fidelity; fake engine + settings so we can assert lifecycle calls.
  const makeSttVad = () => ({
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    dispose: vi.fn(),
  });
  const makePersistence = (on: boolean) => ({ get: () => on, set: vi.fn() });
  // start() runs fire-and-forget out of the subscribe/setStt callbacks — drain a microtask to observe it.
  const flush = (): Promise<void> => Promise.resolve();

  it("auto-resumes on setStt when the persistence port says on", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    wireVoiceInput({ voiceInputStatus, voicePersistence: makePersistence(true) }).setStt(
      sttVad as never,
    );
    await flush();
    expect(sttVad.start).toHaveBeenCalledTimes(1);
  });

  it("starts on listening and stops on idle after the engine is bound", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    wireVoiceInput({ voiceInputStatus, voicePersistence: makePersistence(false) }).setStt(
      sttVad as never,
    );
    await flush();
    expect(sttVad.start).not.toHaveBeenCalled();
    voiceInputStatus.set("listening");
    await flush();
    expect(sttVad.start).toHaveBeenCalledTimes(1);
    voiceInputStatus.set("idle");
    expect(sttVad.stop).toHaveBeenCalledTimes(1);
  });

  it("defers a pre-bind listening request until setStt, then starts", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    const voiceInput = wireVoiceInput({
      voiceInputStatus,
      voicePersistence: makePersistence(false),
    });
    voiceInputStatus.set("listening");
    await flush();
    // No engine yet → start not called.
    expect(sttVad.start).not.toHaveBeenCalled();
    voiceInput.setStt(sttVad as never);
    await flush();
    // startRequested path resumes once bound.
    expect(sttVad.start).toHaveBeenCalledTimes(1);
  });

  it("persists on/off intent through the persistence port", () => {
    const voiceInputStatus = createVoiceInputStatus();
    const voicePersistence = makePersistence(false);
    wireVoiceInput({ voiceInputStatus, voicePersistence });
    voiceInputStatus.set("listening");
    expect(voicePersistence.set).toHaveBeenLastCalledWith(true);
    voiceInputStatus.set("idle");
    expect(voicePersistence.set).toHaveBeenLastCalledWith(false);
  });

  it("without a persistence port it neither resumes on setStt nor throws on a status change", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    const voiceInput = wireVoiceInput({ voiceInputStatus });
    voiceInput.setStt(sttVad as never);
    await flush();
    expect(sttVad.start).not.toHaveBeenCalled();

    voiceInputStatus.set("listening");
    await flush();
    expect(sttVad.start).toHaveBeenCalledTimes(1);
  });

  describe("voice host", () => {
    const bound = (
      voiceHost: { wanted(): boolean; onCaptureStarted(): void; onCaptureFailed(): void },
      sttVad = makeSttVad(),
    ) => {
      const voiceInputStatus = createVoiceInputStatus();
      const voiceInput = wireVoiceInput({ voiceInputStatus, voiceHost });
      voiceInput.setStt(sttVad as never);
      return { voiceInputStatus, sttVad };
    };
    const host = () => ({
      wanted: () => true,
      onCaptureStarted: vi.fn(),
      onCaptureFailed: vi.fn(),
    });

    it("reports a started capture once start() resolves", async () => {
      const h = host();
      const { voiceInputStatus } = bound(h);
      voiceInputStatus.set("listening");
      expect(h.onCaptureStarted).not.toHaveBeenCalled();
      await flush();
      await flush();
      expect(h.onCaptureStarted).toHaveBeenCalledTimes(1);
    });

    it("does not report a capture that failed to start", async () => {
      const h = host();
      const sttVad = makeSttVad();
      sttVad.start.mockRejectedValueOnce(new Error("mic_denied"));
      const { voiceInputStatus } = bound(h, sttVad);
      voiceInputStatus.set("listening");
      await flush();
      await flush();
      expect(h.onCaptureStarted).not.toHaveBeenCalled();
      expect(h.onCaptureFailed).toHaveBeenCalledTimes(1);
      expect(voiceInputStatus.get()).toMatchObject({ state: "error", detail: "mic_denied" });
    });

    it("does not report a capture that stop() cancelled before start() resolved", async () => {
      const h = host();
      let finish!: () => void;
      const sttVad = makeSttVad();
      sttVad.start.mockImplementationOnce(() => new Promise<void>((r) => (finish = r)));
      const { voiceInputStatus } = bound(h, sttVad);
      voiceInputStatus.set("listening");
      await flush();
      voiceInputStatus.set("idle");
      finish();
      await flush();
      await flush();
      expect(h.onCaptureStarted).not.toHaveBeenCalled();
    });
  });

  it("dispose unsubscribes from the status store and disposes the engine", async () => {
    const voiceInputStatus = createVoiceInputStatus();
    const sttVad = makeSttVad();
    const voiceInput = wireVoiceInput({
      voiceInputStatus,
      voicePersistence: makePersistence(false),
    });
    voiceInput.setStt(sttVad as never);
    await flush();
    voiceInput.dispose();
    expect(sttVad.dispose).toHaveBeenCalledTimes(1);
    sttVad.start.mockClear();
    voiceInputStatus.set("listening");
    await flush();
    expect(sttVad.start).not.toHaveBeenCalled();
  });
});

describe("wireTurnVoice", () => {
  beforeEach(() => {
    wireVoicePipeline.mockReset();
  });

  const setup = () => {
    wireVoicePipeline.mockImplementation(() => ({ dispose: vi.fn() }));
    const submitVoice = vi.fn();
    const surfaces = {
      quoteUser: vi.fn(),
      settleQuote: vi.fn(),
      clearQuote: vi.fn(),
      restoreInput: vi.fn(),
    };
    const handle = wireTurnVoice({
      renderer: {} as never,
      surfaces: surfaces as never,
      voiceInputStatus: createVoiceInputStatus(),
      ttsSettings: { get: () => ({ enabled: true }) } as never,
      lipsyncSettings: { get: () => ({ gain: 1 }) } as never,
      fillerSettings: { get: () => ({}) } as never,
      vadSettings: { get: () => ({ silenceMs: 500, bargeIn: true }) } as never,
      speakerSelection: { getActive: () => ({ id: "voice" }) } as never,
      getEndpoints: () => ({}) as never,
      getConfig: () => ({}) as never,
      getSecret: () => Promise.resolve(undefined),
      submitVoice,
      register: vi.fn(),
    });
    return { handle, deps: wireVoicePipeline.mock.calls[0][0], submitVoice, surfaces };
  };

  it("hands the voice host to the error dwell so a revert follows wanted()", () => {
    vi.useFakeTimers();
    try {
      wireVoicePipeline.mockImplementation(() => ({ dispose: vi.fn() }));
      const voiceInputStatus = createVoiceInputStatus();
      const handle = wireTurnVoice({
        renderer: {} as never,
        surfaces: {} as never,
        voiceInputStatus,
        voiceHost: { wanted: () => false, onCaptureStarted: vi.fn(), onCaptureFailed: vi.fn() },
        ttsSettings: { get: () => ({ enabled: true }) } as never,
        lipsyncSettings: { get: () => ({ gain: 1 }) } as never,
        fillerSettings: { get: () => ({}) } as never,
        vadSettings: { get: () => ({ silenceMs: 500, bargeIn: true }) } as never,
        speakerSelection: { getActive: () => ({ id: "voice" }) } as never,
        getEndpoints: () => ({}) as never,
        getConfig: () => ({}) as never,
        getSecret: () => Promise.resolve(undefined),
        submitVoice: vi.fn(),
        register: vi.fn(),
      });

      handle.voiceErrorDwell.show("network_drop");
      vi.advanceTimersByTime(60_000);

      expect(voiceInputStatus.get().state).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("setStrolling reaches the pipeline's stroll query", () => {
    const s = setup();

    expect(s.deps.isStrolling()).toBe(false);

    s.handle.setStrolling({ isStrolling: () => true });
    expect(s.deps.isStrolling()).toBe(true);
  });

  it("an utterance start reaches the previous-turn slot and the quoted turn", () => {
    const s = setup();
    const turn = s.handle.turnLog.begin({
      source: "user_input_source",
      event_name: "user.text_submitted",
      ts: 0,
      payload: { text: "hi" },
    });
    s.handle.quotedTurn.admitted(turn);

    s.deps.onUtteranceStart();
    s.handle.quotedTurn.failed(turn);

    expect(s.surfaces.settleQuote).toHaveBeenCalledTimes(1);
    expect(s.surfaces.restoreInput).not.toHaveBeenCalled();
  });

  it("onVoiceSegment submits the text and notes the interaction once the source is set", () => {
    const s = setup();
    const noteInteraction = vi.fn();

    s.deps.onVoiceSegment("hello");
    expect(s.submitVoice).toHaveBeenCalledWith("hello");

    s.handle.setProactiveSource({ noteInteraction });
    s.deps.onVoiceSegment("again");
    expect(s.submitVoice).toHaveBeenLastCalledWith("again");
    expect(noteInteraction).toHaveBeenCalledTimes(1);
  });
});
