import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CARD } from "../../config/validators/persona/types";
import type { UtteranceIdentity } from "../../contract";
import { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { createSpeechPlayback } from "../../io/voice/tts/speech-playback";
import type { TtsPipelineOptions } from "../../io/voice/tts/tts-pipeline";
import { wireFirstConversation } from "./wire-first-conversation";
import { wireGreeting } from "./wire-greeting";

const OPENED = ["speak:Hi.", "input"];
const HINT = "hint:hint.first_run";
// "Hi." types out in 120 ms, then stays up for 2500 ms.
const READABLE_MS = 2620;

function setup(over: { seen?: boolean; endsInsideSpeak?: boolean; busy?: boolean } = {}) {
  const calls: string[] = [];
  const signals = new Set<() => void>();
  const ends = new Set<(identity: UtteranceIdentity) => void>();
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
      showSpeechAction: vi.fn(),
      hideSpeech: vi.fn(),
    },
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
    connect: () => {
      for (const cb of [...signals]) cb();
    },
    finishPlayback: () => pipeline?.onPlaybackEnd?.(),
  };
}

describe("wireFirstConversation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("greets once on the signal, opens the input when the greeting ends, and shows the hint once it was readable", () => {
    const s = setup();

    s.connect();
    expect(s.calls).toEqual(["speak:Hi."]);

    s.finishPlayback();
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(READABLE_MS - 1);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(1);
    expect(s.calls).toEqual([...OPENED, HINT]);
  });

  it("an interrupted greeting opens the input and the hint the same way", () => {
    const s = setup();

    s.connect();
    s.playback.interrupt();
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(READABLE_MS);
    expect(s.calls).toEqual([...OPENED, HINT]);
  });

  it("with no audio to play, the greeting stays up until it was readable", () => {
    const s = setup({ endsInsideSpeak: true });

    s.connect();
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(READABLE_MS - 1);
    expect(s.calls).toEqual(OPENED);

    vi.advanceTimersByTime(1);
    expect(s.calls).toEqual([...OPENED, HINT]);
  });

  it("skips the hint while a turn is running", () => {
    const s = setup({ busy: true });

    s.connect();
    s.finishPlayback();
    vi.advanceTimersByTime(READABLE_MS);

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

    expect(s.calls).toEqual(["input", HINT]);
    expect(s.ends.size).toBe(0);
  });

  it("leaves the hint out once it was seen, and still opens the input", () => {
    const s = setup({ seen: true });

    s.connect();
    s.finishPlayback();
    vi.advanceTimersByTime(READABLE_MS);

    expect(s.calls).toEqual(OPENED);
  });

  it("dispose drops a hint still waiting", () => {
    const s = setup();

    s.connect();
    s.finishPlayback();
    s.wired.dispose();
    vi.advanceTimersByTime(READABLE_MS);

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
