import type { FillerPool } from "../../../config/validators/filler";
import type { TurnFailure } from "../../../dispatcher/backend/backend-caller";
import type { TurnOutput } from "../../../dispatcher/turn/turn-output";
import { DEFAULT_TOOL_KEY, type FillerLoop } from "../../../io/voice/filler/filler-loop";
import { createShuffleBag } from "../../../io/voice/filler/shuffle-bag";
import type { SpeechPlayback } from "../../../io/voice/tts/speech-playback";

interface SpeakTurnDeps {
  speechPlayback: SpeechPlayback;
  fillerLoop: FillerLoop;
  getPools: () => FillerPool;
  playMotion: (motion: { id: string; loop?: boolean } | null) => void;
  isStrolling: () => boolean;
  bargeInEnabled: () => boolean;
  onBargeIn?: () => void;
  onSpeechActive?: () => void;
}

/** Owns the turn's speech lifecycle; synthesis and playback remain injected I/O. */
export function createSpeakTurn(deps: SpeakTurnDeps) {
  const { speechPlayback, fillerLoop } = deps;
  // Only the current thinking turn may release its motion or update its filler.
  let thinkingTurnId: number | null = null;

  function hasFiller(): boolean {
    const pool = deps.getPools();
    return (
      pool.first.length > 0 ||
      pool.repeat.length > 0 ||
      pool.long_wait.length > 0 ||
      Object.keys(pool.tool).length > 0
    );
  }

  function onThinkingStart(turnId: number): void {
    thinkingTurnId = turnId;
    // hold BEFORE the first filler can speak so no filler sentence resets the motion.
    speechPlayback.holdMotion(true);
    if (!deps.isStrolling()) deps.playMotion({ id: "thinking", loop: true });
    fillerLoop.start();
  }

  function resumeThinking(): void {
    if (thinkingTurnId === null) return;
    deps.playMotion({ id: "thinking", loop: true });
  }

  function onThinkingEnd(turnId: number): void {
    if (turnId !== thinkingTurnId) return;
    thinkingTurnId = null;
    // A cue parked under the hold applies here; its motion is the one to keep.
    const applied = speechPlayback.holdMotion(false);
    fillerLoop.stop();
    // thinking is loop:true — without an explicit return to idle it spins forever and pollutes previousStable.
    if (!applied && !deps.isStrolling()) deps.playMotion(null);
  }

  const turnOutput: TurnOutput = {
    interrupt: () => speechPlayback.interrupt(),
    hasFiller,
    thinkingStart: onThinkingStart,
    thinkingEnd: onThinkingEnd,
    delta: (text, identity) => speechPlayback.onSpeechDelta(text, identity),
    speak: (text, identity) => speechPlayback.onSpeech(text, identity),
    end: () => speechPlayback.onSpeechEnd(),
    abort: () => speechPlayback.abort(),
    cue: (args) => speechPlayback.setCue(args),
    cueWithSpeech: (args) => speechPlayback.setCue(args, { withSpeech: true }),
    silentCue: (args) => speechPlayback.silentCue(args),
    toolStatus: (turnId, state, toolId) => {
      // Ignores an event from a turn other than the one currently thinking — a superseded turn's
      // late tool_status must not reach whichever newer turn's filler loop is now running.
      if (turnId !== thinkingTurnId) return;
      if (state === "running") fillerLoop.onToolRunning(toolId ?? DEFAULT_TOOL_KEY);
      else fillerLoop.onActivity();
    },
    activity: (turnId) => {
      if (turnId !== thinkingTurnId) return;
      fillerLoop.onActivity();
    },
    releaseMute: () => speechPlayback.releaseMute(),
    hasOutstandingSpeech: () => speechPlayback.hasOutstandingSpeech(),
    onQueueDrained: (callback) => speechPlayback.onQueueDrained(callback),
  };

  // One bag per failure tier, drawn the same way the filler loop draws its own tiers.
  const timeoutBag = createShuffleBag();
  const unreachableBag = createShuffleBag();

  function speakFailure(reason: TurnFailure): void {
    const pool = deps.getPools();
    const phrase =
      reason === "network_stall"
        ? timeoutBag.draw(pool.timeout)
        : reason === "network_drop"
          ? unreachableBag.draw(pool.unreachable)
          : undefined;
    if (phrase === undefined) return;
    speechPlayback.speakAside(phrase);
  }

  function onSpeechActive(): void {
    deps.onSpeechActive?.();
    if (deps.bargeInEnabled() && speechPlayback.hasOutstandingSpeech()) {
      deps.onBargeIn?.();
      speechPlayback.interrupt({ muteCurrentTurn: true });
      // The interrupted utterance can no longer drive the filler loop's completion.
      fillerLoop.stop();
    }
  }

  return { turnOutput, speakFailure, resumeThinking, onSpeechActive };
}
