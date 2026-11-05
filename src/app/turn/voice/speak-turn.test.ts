import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FillerPool } from "../../../config/validators/filler";
import type { FillerLoop } from "../../../io/voice/filler/filler-loop";
import { fillerPool } from "../../../io/voice/filler/filler-test-helpers";
import type { SpeechPlayback } from "../../../io/voice/tts/speech-playback";
import { createSpeakTurn } from "./speak-turn";

function createFakes() {
  const speech = { outstanding: false };
  const speechPlayback = {
    onSpeechDelta: vi.fn<SpeechPlayback["onSpeechDelta"]>(() => {
      speech.outstanding = true;
    }),
    onSpeech: vi.fn<SpeechPlayback["onSpeech"]>(() => {
      speech.outstanding = true;
    }),
    onSpeechEnd: vi.fn(),
    speakAside: vi.fn(),
    setCue: vi.fn(),
    silentCue: vi.fn(),
    holdMotion: vi.fn(() => false),
    interrupt: vi.fn<SpeechPlayback["interrupt"]>(() => {
      speech.outstanding = false;
    }),
    hasOutstandingSpeech: vi.fn(() => speech.outstanding),
    abort: vi.fn(),
    dispose: vi.fn(),
    releaseMute: vi.fn(),
    onQueueDrained: vi.fn(),
  } satisfies SpeechPlayback;
  const fillerLoop = {
    start: vi.fn(),
    stop: vi.fn(),
    onUtteranceDone: vi.fn(),
    onToolRunning: vi.fn(),
    onActivity: vi.fn(),
    onSynthFailure: vi.fn(),
  } satisfies FillerLoop;
  return { speechPlayback, fillerLoop };
}
let mocks: ReturnType<typeof createFakes>;
beforeEach(() => {
  mocks = createFakes();
});

function setup(over: { isStrolling?: () => boolean } = {}) {
  let pools: FillerPool = fillerPool({ first: ["first"], repeat: ["repeat"] });
  let bargeIn = false;
  const renderer = { playMotion: vi.fn() };
  const onBargeIn = vi.fn();
  const onSpeechActive = vi.fn();
  const voice = createSpeakTurn({
    ...mocks,
    getPools: () => pools,
    playMotion: renderer.playMotion,
    isStrolling: over.isStrolling ?? (() => false),
    bargeInEnabled: () => bargeIn,
    onBargeIn,
    onSpeechActive,
  });
  return {
    voice,
    renderer,
    onBargeIn,
    onSpeechActive,
    setPools: (next: FillerPool) => {
      pools = next;
    },
    setBargeIn: (next: boolean) => {
      bargeIn = next;
    },
  };
}

describe("speakTurn", () => {
  it("A's late thinkingEnd(idA) does not tear down B's thinking once B's thinkingStart(idB) has begun", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart(1); // A starts
    voice.turnOutput.thinkingStart(2); // B starts before A's late end arrives
    vi.clearAllMocks();
    voice.turnOutput.thinkingEnd(1); // A's late end

    expect(mocks.speechPlayback.holdMotion).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.stop).not.toHaveBeenCalled();
    expect(renderer.playMotion).not.toHaveBeenCalled();

    voice.turnOutput.thinkingEnd(2); // B's own end
    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(false);
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("a turn's own thinkingEnd tears down its hold, filler and motion", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.thinkingEnd(1);

    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(false);
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("keeps the motion released by the hold, instead of returning the body to idle", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.silentCue({ motion_id: "wave" });
    renderer.playMotion.mockClear();
    mocks.speechPlayback.holdMotion.mockReturnValueOnce(true);
    voice.turnOutput.thinkingEnd(1);

    expect(mocks.speechPlayback.silentCue).toHaveBeenCalledWith({ motion_id: "wave" });
    expect(renderer.playMotion).not.toHaveBeenCalled();
  });

  it("holds motion before starting the thinking motion and filler", () => {
    const { voice, renderer } = setup();

    voice.turnOutput.thinkingStart(1);

    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(true);
    expect(renderer.playMotion).toHaveBeenCalledWith({ id: "thinking", loop: true });
    expect(mocks.speechPlayback.holdMotion.mock.invocationCallOrder[0]).toBeLessThan(
      renderer.playMotion.mock.invocationCallOrder[0]!,
    );
    expect(renderer.playMotion.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.fillerLoop.start.mock.invocationCallOrder[0]!,
    );
  });

  it("leaves the body to a running stroll when thinking starts, and still holds motion and starts the filler", () => {
    const { voice, renderer } = setup({ isStrolling: () => true });

    voice.turnOutput.thinkingStart(1);

    expect(mocks.speechPlayback.holdMotion).toHaveBeenCalledWith(true);
    expect(renderer.playMotion).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.start).toHaveBeenCalledTimes(1);
  });

  it("leaves the body to a running stroll when thinking ends, and returns to idle once the stroll is gone", () => {
    let strolling = true;
    const { voice, renderer } = setup({ isStrolling: () => strolling });

    voice.turnOutput.thinkingStart(1);
    renderer.playMotion.mockClear();
    voice.turnOutput.thinkingEnd(1);
    expect(renderer.playMotion).not.toHaveBeenCalledWith(null);

    strolling = false;
    voice.turnOutput.thinkingStart(2);
    renderer.playMotion.mockClear();
    voice.turnOutput.thinkingEnd(2);
    expect(renderer.playMotion).toHaveBeenCalledWith(null);
  });

  it("replays the thinking clip when the stroll ends while the turn is still thinking", () => {
    let strolling = true;
    const { voice, renderer } = setup({ isStrolling: () => strolling });

    voice.turnOutput.thinkingStart(1);
    strolling = false;
    voice.resumeThinking();

    expect(renderer.playMotion).toHaveBeenCalledWith({ id: "thinking", loop: true });
  });

  it("does not replay thinking after the turn's thinking has ended", () => {
    let strolling = true;
    const { voice, renderer } = setup({ isStrolling: () => strolling });

    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.thinkingEnd(1);
    renderer.playMotion.mockClear();
    strolling = false;
    voice.resumeThinking();

    expect(renderer.playMotion).not.toHaveBeenCalled();
  });

  it("reports whether either effective filler pool is non-empty", () => {
    const state = setup();
    state.setPools(fillerPool());
    expect(state.voice.turnOutput.hasFiller()).toBe(false);

    state.setPools(fillerPool({ first: ["first"], repeat: [] }));
    expect(state.voice.turnOutput.hasFiller()).toBe(true);

    state.setPools(fillerPool({ first: [], repeat: ["repeat"] }));
    expect(state.voice.turnOutput.hasFiller()).toBe(true);
  });

  it("counts long_wait and tool as filler too — a pool with only those still opens a thinking window", () => {
    const state = setup();
    state.setPools(fillerPool({ long_wait: ["still working on it"] }));
    expect(state.voice.turnOutput.hasFiller()).toBe(true);

    state.setPools(fillerPool({ tool: { terminal: ["running it"] } }));
    expect(state.voice.turnOutput.hasFiller()).toBe(true);
  });

  it("speakFailure speaks as an aside", () => {
    const state = setup();
    state.setPools(fillerPool({ timeout: ["少し待ってね"] }));
    state.voice.speakFailure("network_stall");
    expect(mocks.speechPlayback.speakAside).toHaveBeenCalledWith("少し待ってね");
    expect(mocks.speechPlayback.onSpeech).not.toHaveBeenCalled();
    expect(mocks.speechPlayback.onSpeechEnd).not.toHaveBeenCalled();
  });

  it("toolStatus(turnId, 'running', id) calls fillerLoop.onToolRunning(id) while that turn is thinking", () => {
    const { voice } = setup();
    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.toolStatus(1, "running", "terminal");
    expect(mocks.fillerLoop.onToolRunning).toHaveBeenCalledWith("terminal");
  });

  it("toolStatus(turnId, 'done'|'idle'|'error') calls fillerLoop.onActivity() while that turn is thinking", () => {
    const { voice } = setup();
    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.toolStatus(1, "done");
    voice.turnOutput.toolStatus(1, "idle");
    voice.turnOutput.toolStatus(1, "error");
    expect(mocks.fillerLoop.onActivity).toHaveBeenCalledTimes(3);
    expect(mocks.fillerLoop.onToolRunning).not.toHaveBeenCalled();
  });

  it("activity(turnId) calls fillerLoop.onActivity() while that turn is thinking", () => {
    const { voice } = setup();
    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.activity(1);
    expect(mocks.fillerLoop.onActivity).toHaveBeenCalledOnce();
  });

  it("ignores toolStatus/activity when no turn is thinking", () => {
    const { voice } = setup();
    voice.turnOutput.toolStatus(1, "running", "terminal");
    voice.turnOutput.activity(1);
    expect(mocks.fillerLoop.onToolRunning).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.onActivity).not.toHaveBeenCalled();
  });

  it("ignores toolStatus/activity once thinking has ended", () => {
    const { voice } = setup();
    voice.turnOutput.thinkingStart(1);
    voice.turnOutput.thinkingEnd(1);
    vi.clearAllMocks();
    voice.turnOutput.toolStatus(1, "running", "terminal");
    voice.turnOutput.activity(1);
    expect(mocks.fillerLoop.onToolRunning).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.onActivity).not.toHaveBeenCalled();
  });

  it("ignores toolStatus/activity from a superseded turn once a newer turn is thinking", () => {
    const { voice } = setup();
    voice.turnOutput.thinkingStart(1); // turn A starts thinking
    voice.turnOutput.thinkingStart(2); // turn B supersedes A before A's late events arrive
    vi.clearAllMocks();

    // Late events from the superseded turn A must not reach B's filler loop.
    voice.turnOutput.toolStatus(1, "running", "terminal");
    voice.turnOutput.activity(1);
    expect(mocks.fillerLoop.onToolRunning).not.toHaveBeenCalled();
    expect(mocks.fillerLoop.onActivity).not.toHaveBeenCalled();

    // Turn B's own events still reach it.
    voice.turnOutput.toolStatus(2, "running", "terminal");
    voice.turnOutput.activity(2);
    expect(mocks.fillerLoop.onToolRunning).toHaveBeenCalledWith("terminal");
    expect(mocks.fillerLoop.onActivity).toHaveBeenCalledOnce();
  });

  it("interrupts active playback only when barge-in is enabled", () => {
    const state = setup();
    const onSpeechActive = state.voice.onSpeechActive;

    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();

    state.setBargeIn(true);
    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();

    state.voice.turnOutput.delta("여기 있어.", { turn_id: "7", event_name: "user.text_submitted" });
    state.voice.turnOutput.end();
    onSpeechActive();
    expect(mocks.speechPlayback.interrupt).toHaveBeenCalledWith({ muteCurrentTurn: true });
  });

  it("reports the start of a voice turn even with barge-in off", () => {
    const state = setup();

    state.voice.onSpeechActive();

    expect(state.onSpeechActive).toHaveBeenCalledOnce();
    expect(mocks.speechPlayback.interrupt).not.toHaveBeenCalled();
  });

  it("barges in on speech a render started", () => {
    const state = setup();
    const onSpeechActive = state.voice.onSpeechActive;

    state.setBargeIn(true);
    state.voice.turnOutput.delta("여기 있어.", { turn_id: "7", event_name: "user.text_submitted" });
    state.voice.turnOutput.end();
    onSpeechActive();

    expect(mocks.speechPlayback.interrupt).toHaveBeenCalledWith({ muteCurrentTurn: true });
  });

  it("reports the barge-in, so the reply the user talked over stops arriving", () => {
    const state = setup();
    const onSpeechActive = state.voice.onSpeechActive;

    state.setBargeIn(true);
    onSpeechActive();
    expect(state.onBargeIn).not.toHaveBeenCalled();

    state.voice.turnOutput.delta("여기 있어.", { turn_id: "7", event_name: "user.text_submitted" });
    state.voice.turnOutput.end();
    onSpeechActive();
    expect(state.onBargeIn).toHaveBeenCalledOnce();
  });

  it("stops the filler loop when barge-in interrupts", () => {
    const state = setup();
    const onSpeechActive = state.voice.onSpeechActive;

    state.setBargeIn(true);
    state.voice.turnOutput.thinkingStart(1);
    state.voice.turnOutput.delta("여기 있어.", { turn_id: "7", event_name: "user.text_submitted" });
    state.voice.turnOutput.end();
    onSpeechActive();

    // The interrupted utterance is disposed, so its onPlaybackEnd can never reschedule the loop.
    expect(mocks.fillerLoop.stop).toHaveBeenCalledOnce();
  });

  it("barges in in order: speech-active, barge-in callback, mute interruption, filler stop", () => {
    const state = setup();
    state.setBargeIn(true);
    state.voice.turnOutput.delta("여기 있어.", { turn_id: "7", event_name: "user.text_submitted" });
    state.voice.onSpeechActive();

    const order = [
      state.onSpeechActive,
      state.onBargeIn,
      mocks.speechPlayback.interrupt,
      mocks.fillerLoop.stop,
    ].map((fn) => fn.mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(mocks.speechPlayback.interrupt).toHaveBeenCalledWith({ muteCurrentTurn: true });
  });
});
