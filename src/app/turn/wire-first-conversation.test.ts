import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CARD } from "../../config/validators/persona/types";
import type { UtteranceIdentity } from "../../contract";
import type { SpeechAction } from "../../io/bridge/message/message-remote";
import { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { createSpeechPlayback } from "../../io/voice/tts/speech-playback";
import type { TtsPipelineOptions } from "../../io/voice/tts/tts-pipeline";
import { wireFirstConversation } from "./wire-first-conversation";
import { wireGreeting } from "./wire-greeting";

const OPENED = ["speak:Hi.", "input"];
const HINT = "hint:hint.first_run";
const TYPED_MS = 120; // "Hi." at 40 ms per character.
const READ_MS = 2500;

function setup(over: { seen?: boolean; endsInsideSpeak?: boolean; busy?: boolean } = {}) {
  const calls: string[] = [];
  const signals = new Set<() => void>();
  const ends = new Set<(identity: UtteranceIdentity) => void>();
  const showSpeechActions = vi.fn<(actions: readonly SpeechAction[]) => void>();
  const submitGuide = vi.fn((guide: string) => calls.push(`guide:${guide}`));
  let pipeline: TtsPipelineOptions | undefined;
  const playback = createSpeechPlayback({
    renderer: {
      setMouthOpen: vi.fn(),
      stopMouth: vi.fn(),
      easeEmotionToNeutral: vi.fn(),
      applyDirective: vi.fn(),
      playMotion: vi.fn(),
    },
    surfaces: {
      beginSpeech: vi.fn(),
      pushSpeech: vi.fn(),
      endSpeech: vi.fn(),
      finishSpeech: vi.fn(),
    },
    isStrolling: () => false,
    pipeline: { synth: () => Promise.reject(new Error("unused")) },
    createPipeline: (opts) => {
      pipeline = opts;
      return {
        pushTextDelta: vi.fn(),
        setCue: vi.fn(),
        end: () => {
          if (over.endsInsideSpeak) opts.onPlaybackEnd?.();
        },
        hasOutstandingWork: () => false,
        spokenSplit: () => ({ spoken: "", unspoken: "" }),
        dispose: vi.fn(),
      };
    },
    onUtteranceEnd: (_ended, _split, identity) => {
      for (const cb of ends) cb(identity);
    },
  });
  const transcript = createChatHistoryStore();
  const greeting = wireGreeting({
    onSessionReset: () => () => {},
    presetId: "p1",
    stopTurn: () => {},
    transcript,
    getCard: () => ({ card: { ...EMPTY_CARD, first_mes: "Hi." }, charName: "Yui" }),
    userName: () => "Sam",
    speak: (text, identity) => {
      calls.push(`speak:${text}`);
      playback.onSpeech(text, identity);
    },
  });
  const wired = wireFirstConversation({
    onFirstConversationConnected: (cb) => {
      signals.add(cb);
      return () => signals.delete(cb);
    },
    onUtteranceEnd: (cb) => {
      ends.add(cb);
      return () => ends.delete(cb);
    },
    greetLocal: greeting.greetLocal,
    transcript,
    isBusy: () => over.busy ?? false,
    surfaces: {
      summonInput: () => calls.push("input"),
      beginSpeech: vi.fn(),
      pushSpeech: (text) => calls.push(`hint:${text}`),
      endSpeech: vi.fn(),
      showSpeechActions,
      hideSpeech: () => calls.push("hide"),
    },
    submitGuide,
    seen: () => over.seen ?? false,
    markSeen: vi.fn(),
    hotkey: "CmdOrCtrl+Shift+Y",
    isMac: false,
    openSettings: vi.fn(),
    t: (key) => key,
  });
  return {
    calls,
    signals,
    ends,
    transcript,
    wired,
    playback,
    showSpeechActions,
    submitGuide,
    connect: () => {
      for (const cb of [...signals]) cb();
    },
    finishPlayback: () => pipeline?.onPlaybackEnd?.(),
  };
}

function speakThrough(s: ReturnType<typeof setup>): void {
  s.connect();
  vi.advanceTimersByTime(TYPED_MS);
  s.finishPlayback();
  vi.advanceTimersByTime(0);
}

describe("wireFirstConversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets once on the signal, opens the input when the spoken greeting ends, and shows the hint once it was readable", () => {
    const s = setup();

    s.connect();
    expect(s.calls).toEqual(["speak:Hi."]);

    vi.advanceTimersByTime(TYPED_MS);
    s.finishPlayback();
    vi.advanceTimersByTime(0);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(READ_MS - 1);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(1);
    expect(s.calls).toEqual([...OPENED, HINT]);
  });

  it("offers the two guides under the hint, each submitting its request", () => {
    const s = setup();

    speakThrough(s);
    vi.advanceTimersByTime(READ_MS);

    expect(s.showSpeechActions).toHaveBeenCalledTimes(1);
    const actions = s.showSpeechActions.mock.calls[0]![0];
    expect(actions.map((a) => a.label)).toEqual(["help.controls.hear", "help.capabilities.hear"]);
    actions[0]!.onClick();
    actions[1]!.onClick();
    expect(s.submitGuide.mock.calls).toEqual([
      ["controls", "help.controls.request"],
      ["capabilities", "help.capabilities.request"],
    ]);
  });

  // With the unified window shown the reply goes to the stream, so nothing else replaces the held bubble.
  it("a guide press drops the hint before it submits", () => {
    const s = setup();
    speakThrough(s);
    vi.advanceTimersByTime(READ_MS);

    s.showSpeechActions.mock.calls[0]![0][1]!.onClick();

    expect(s.calls).toEqual([...OPENED, HINT, "hide", "guide:capabilities"]);
  });

  it("an interrupted greeting opens the input and the hint the same way", () => {
    const s = setup();

    s.connect();
    s.playback.interrupt();
    expect(s.calls).toEqual(["speak:Hi."]);

    vi.advanceTimersByTime(TYPED_MS);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(READ_MS);
    expect(s.calls).toEqual([...OPENED, HINT]);
  });

  it("with no audio to play, the input waits for the greeting to type out", () => {
    const s = setup({ endsInsideSpeak: true });

    s.connect();
    vi.advanceTimersByTime(TYPED_MS - 1);
    expect(s.calls).toEqual(["speak:Hi."]);

    vi.advanceTimersByTime(1);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(READ_MS - 1);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(1);
    expect(s.calls).toEqual([...OPENED, HINT]);
  });

  it("skips the hint while a turn is running", () => {
    const s = setup({ busy: true });

    speakThrough(s);
    vi.advanceTimersByTime(READ_MS);

    expect(s.calls).toEqual(OPENED);
  });

  it("ignores an utterance that is not the greeting", () => {
    const s = setup();

    s.connect();
    for (const cb of [...s.ends]) cb({ turn_id: "greeting:9", event_name: "user.text_submitted" });

    expect(s.calls).toEqual(["speak:Hi."]);
  });

  it("on a session that already has entries, opens the input and the hint at once with no greeting", () => {
    const s = setup();
    s.transcript.append({ role: "user", text: "hello", ts: 1 });

    s.connect();

    expect(s.calls).toEqual(["hide", "input", HINT]);
    expect(s.ends.size).toBe(0);
  });

  it("with no greeting and the hint already seen, the setup bubble still leaves", () => {
    const s = setup({ seen: true });
    s.transcript.append({ role: "user", text: "hello", ts: 1 });

    s.connect();

    expect(s.calls).toEqual(["hide", "input"]);
  });

  it("leaves the hint and its guides out once it was seen, and still opens the input", () => {
    const s = setup({ seen: true });

    speakThrough(s);
    vi.advanceTimersByTime(READ_MS);

    expect(s.calls).toEqual(OPENED);
    expect(s.showSpeechActions).not.toHaveBeenCalled();
  });

  it("dispose drops a hint still waiting", () => {
    const s = setup();

    speakThrough(s);
    s.wired.dispose();
    vi.advanceTimersByTime(READ_MS);

    expect(s.calls).toEqual(OPENED);
  });

  it("dispose leaves no subscription, mid-greeting included", () => {
    const s = setup();

    s.connect();
    expect(s.ends.size).toBe(1);
    s.wired.dispose();

    expect(s.signals.size).toBe(0);
    expect(s.ends.size).toBe(0);
  });
});
