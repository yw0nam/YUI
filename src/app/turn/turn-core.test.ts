// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

const { dispatcher, pushTurns, speechPlayback } = vi.hoisted(() => ({
  dispatcher: { cancel: vi.fn(), start: vi.fn() },
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
          onSynthFailure: () => () => {},
          onTtsReach: () => () => {},
          reconnectTts: async () => true,
          createSttEngine: createSttEngine as unknown as TurnVoice["voice"]["createSttEngine"],
          dispose: () => {},
          onUtteranceStart: () => () => {},
          onUtteranceEnd: () => () => {},
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
vi.mock("./vocabulary/wire-vocabulary", () => ({
  wireVocabulary: async () => ({
    vocabulary: () => ({}),
    subscribe: () => () => {},
    dispose: () => {},
  }),
}));
vi.mock("./wire-dispatcher", () => ({
  wireDispatcher: () => ({ dispatcher, setPeek: () => {} }),
}));
vi.mock("../settings/wire-avatar", () => ({ applyAvatarConfig: () => {} }));
vi.mock("./push/playback", () => ({ wirePlayback: () => () => {} }));
vi.mock("./push/wire-push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./push/wire-push")>()),
  wirePushTransport: () => () => {},
}));

import type { AttachedThread } from "../../contract";
import type { BusEnvelope } from "../../dispatcher/core/event-bus";
import { createUserInputSource } from "../../dispatcher/sources/user-input-source";
import type { ThreadsAttachRequest, UserTurnRouted } from "../../io/bridge/settings-bridge";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import { type TurnCorePhase1, wireTurnCore } from "./turn-core";

function wire(over: Partial<TurnCorePhase1> = {}) {
  let onStop: () => void = () => {};
  let onStopTurns: () => void = () => {};
  const teardowns: Array<() => void> = [];
  const phase1 = {
    config: { get: () => ({}) },
    surfaces: {
      onStop: (cb: () => void) => (onStop = cb),
      onSubmit: () => {},
      setCommands: () => {},
      onCommand: () => {},
      showCommandReply: () => {},
      onCommandReplyClose: () => {},
      setAsks: vi.fn(),
      onAskAnswer: vi.fn(),
    },
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
    speaker: {
      migrateVoiceIds: async () => {},
      refreshVoiceList: () => {},
      checkTtsServer: async () => null,
    },
    ...over,
  } as unknown as TurnCorePhase1;
  const core = wireTurnCore({} as never, phase1, {
    contextProviders: { getFrontmost: () => undefined },
    screenCapturer: {} as never,
    openSettings: () => {},
    turnNotice: { show: () => {}, clear: () => {} },
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
    const off = () => () => {};
    const h = wire({
      pushSocket: {
        sendStop,
        sendVocabulary: () => {},
        getCommands: () => [],
        onCommands: off,
        onCommandReply: off,
        sendCommand: () => true,
        onAsk: off,
        onAskEnd: off,
        onState: off,
      } as never,
    });
    const core = await h.core;
    await core.connect({ onSubmit: () => {} });

    h.stopFromUnified();

    expect(sendStop).not.toHaveBeenCalled();
  });

  it("does not create an STT engine in a bound pet", async () => {
    await wire({ bound: true }).core;
    expect(createSttEngine).not.toHaveBeenCalled();
  });

  describe("main's attached Threads", () => {
    const A = { id: "gmail:18c2", source: "gmail", title: "Quote reply" };
    const B = { id: "slack:C07:1732", source: "slack", title: "0.9 cut" };
    const C = { id: "codex:7", source: "codex", title: "Fix the flaky test" };
    const D = { id: "codex:8", source: "codex", title: "Bump the lockfile" };

    async function main() {
      let request: (r: ThreadsAttachRequest) => void = () => {};
      let ready: () => void = () => {};
      let routedTurn: (e: UserTurnRouted) => void = () => {};
      type Submit = (text: string, images: string[], threads: AttachedThread[]) => void;
      const submits: Submit[] = [];
      let open = false;
      const pushed: BusEnvelope[] = [];
      const emitThreadsAttached = vi.fn();
      const setThreads = vi.fn();
      const summonInput = vi.fn(() => {
        open = true;
      });
      const h = wire({
        unifiedShown: { get: () => false },
        threadsAttach: {
          onThreadsAttachRequest: (cb) => {
            request = cb;
            return () => {};
          },
          onThreadsReady: (cb) => {
            ready = cb;
            return () => {};
          },
          onUserTurnRouted: (cb) => {
            routedTurn = cb;
            return () => {};
          },
          emitThreadsAttached,
        },
        userInput: createUserInputSource({
          push: (e) => pushed.push(e) > 0,
          pop: () => null,
          snapshot: () => [],
        }),
        surfaces: {
          onStop: () => {},
          onSubmit: (cb: Submit) => submits.push(cb),
          setCommands: () => {},
          onCommand: () => {},
          showCommandReply: () => {},
          onCommandReplyClose: () => {},
          setAsks: vi.fn(),
          onAskAnswer: vi.fn(),
          setThreads,
          onThreadRemove: () => {},
          summonInput,
          isInputOpen: () => open,
        } as never,
      });
      await (await h.core).connect({ onSubmit: () => {} });
      return {
        toggle: (thread: AttachedThread) => request({ op: "toggle", thread }),
        remove: (thread: AttachedThread) => request({ op: "remove", thread }),
        ready: () => ready(),
        routedTurn: (e: UserTurnRouted) => routedTurn(e),
        submit: (text: string, threads: AttachedThread[]) => {
          for (const cb of submits) cb(text, [], threads);
        },
        restore: (threads: AttachedThread[]) => voiceDeps.at(-1)!.restoreThreads?.(threads),
        speak: (text: string) => voiceDeps.at(-1)!.submitVoice(text),
        shown: () => setThreads.mock.lastCall?.[0],
        sent: () => emitThreadsAttached.mock.lastCall?.[0],
        payloads: () => pushed.map((e) => e.payload),
        summonInput,
      };
    }

    it("attaches each Thread once, opens a closed input on the first, and tells the Threads window on every change and on its ready", async () => {
      const m = await main();

      m.toggle(A);
      m.toggle(B);
      m.toggle(A);
      m.toggle(C);
      m.remove(B);
      m.toggle(A);

      expect(m.shown()).toEqual([C, A]);
      expect(m.sent()).toEqual({ threads: [C, A] });
      expect(m.summonInput).toHaveBeenCalledOnce();

      m.ready();
      expect(m.sent()).toEqual({ threads: [C, A] });
    });

    it("sends the Threads a submit showed, keeps one attached after the click, and puts a failed send's back once", async () => {
      const m = await main();
      m.toggle(A);
      m.toggle(B);
      m.toggle(C);

      m.toggle(D);
      m.submit("handle these", [A, B, C]);

      expect(m.payloads()).toEqual([{ text: "handle these", threads_attached: [A, B, C] }]);
      expect(m.shown()).toEqual([D]);

      m.remove(D);
      m.submit("thanks", []);
      expect(m.payloads().at(-1)).toEqual({ text: "thanks" });

      m.restore([A, B, C]);
      m.restore([A]);
      expect(m.shown()).toEqual([A, B, C]);

      m.routedTurn({ sendId: "s1", to: presetIdForWindow(), text: "", threads: [A, C] });
      expect(m.shown()).toEqual([B]);
    });

    it("sends the shown Threads with a spoken message and drops them", async () => {
      const m = await main();
      m.toggle(A);
      m.toggle(B);

      m.speak("handle these");

      expect(m.payloads()).toEqual([{ text: "handle these", threads_attached: [A, B] }]);
      expect(m.shown()).toEqual([]);
    });
  });
});
