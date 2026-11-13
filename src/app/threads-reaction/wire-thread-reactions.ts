/** Main only: Thread reactions read the window's Threads client, the Threads window, the chip's taps, presence, speech, the turn pipeline and the stage, and hold or fire the snapshot Threads' buffered turns; a window without a Threads client wires nothing. */

import { invoke } from "@tauri-apps/api/core";
import { createThreadReaction } from "../../ambient/threads-reaction/thread-reaction";
import type { ConfigStore } from "../../config/store";
import type { ScreenRect, WindowRect } from "../../contract";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import { createPresence } from "../../io/presence/presence";
import type { ThreadsClient } from "../../io/threads/threads-client";
import { effectiveFillerPool } from "../../io/voice/filler/filler-pool";
import type { SpeechPlayback } from "../../io/voice/tts/speech-playback";
import type { ThreadsWindowController } from "../../io/window/openers/threads-window";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import type { ConfiguredBootstrapHandles } from "../bootstrap-configured";

export function wireThreadReactions(deps: {
  threads: ThreadsClient | null;
  threadsWindow: ThreadsWindowController | null;
  /** The Threads chip's slot rect; null without a chip. */
  slotRect: (() => ScreenRect) | null;
  /** The chip's tap subscription; a no-op without a chip. */
  chipTaps: (cb: () => void) => () => void;
  dispatcher: Pick<Dispatcher, "isPipelineBusy">;
  speechPlayback: Pick<SpeechPlayback, "hasOutstandingSpeech" | "speakAsideAndWait">;
  locomotion: ConfiguredBootstrapHandles["locomotion"];
  renderer: Pick<Renderer, "setEmotion" | "easeEmotionToNeutral" | "land">;
  settings: Pick<
    SettingsStores,
    | "threadReactionsSettings"
    | "threadReactionThresholdsSettings"
    | "presenceSettings"
    | "fillerSettings"
  >;
  config: Pick<ConfigStore, "get">;
  threadTurn: ConfiguredBootstrapHandles["threadTurn"];
}): () => void {
  const { threads, threadsWindow, slotRect, chipTaps, speechPlayback, locomotion, renderer, settings } =
    deps;
  if (!threads || !threadsWindow) return () => {};
  const presence = createPresence({
    threshold: () => settings.presenceSettings.get().value,
  });
  const reaction = createThreadReaction({
    threads,
    enabled: settings.threadReactionsSettings,
    thresholds: settings.threadReactionThresholdsSettings,
    isPresent: () => presence.isPresent(),
    chipTaps,
    isPipelineBusy: deps.dispatcher.isPipelineBusy,
    hasOutstandingSpeech: () => speechPlayback.hasOutstandingSpeech(),
    getExecutor: locomotion.getAvatarExecutor,
    armedSit: locomotion.armedSit,
    threadsWindow,
    slotRect: () => slotRect?.(),
    listWindows: () => invoke<WindowRect[]>("list_windows"),
    speak: (text) => speechPlayback.speakAsideAndWait(text),
    lines: () => effectiveFillerPool(settings.fillerSettings.get(), deps.config.get().filler),
    setEmotion: (signal) => renderer.setEmotion(signal),
    easeEmotionToNeutral: () => renderer.easeEmotionToNeutral(),
    land: () => renderer.land(),
    holdMs: () => deps.config.get().avatar.tap.touch_emotion_hold_ms,
    turn: deps.threadTurn,
  });
  return () => {
    reaction.dispose();
    presence.dispose();
  };
}
