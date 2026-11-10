/** Main only: Thread reactions read the window's Threads client, the Threads window and chip, speech, the turn pipeline and the stage, and hold or fire each Thread's buffered turn; a window without a Threads client wires nothing. */

import { invoke } from "@tauri-apps/api/core";
import { createThreadReaction } from "../../ambient/threads-reaction/thread-reaction";
import type { ConfigStore } from "../../config/store";
import type { ScreenRect, WindowRect } from "../../contract";
import type { Dispatcher } from "../../dispatcher/dispatcher";
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
  dispatcher: Pick<Dispatcher, "isPipelineBusy">;
  speechPlayback: Pick<SpeechPlayback, "hasOutstandingSpeech" | "speakAsideAndWait">;
  locomotion: ConfiguredBootstrapHandles["locomotion"];
  renderer: Pick<Renderer, "setEmotion" | "easeEmotionToNeutral" | "land">;
  settings: Pick<SettingsStores, "threadReactionsSettings" | "fillerSettings">;
  config: Pick<ConfigStore, "get">;
  threadTurn: ConfiguredBootstrapHandles["threadTurn"];
}): () => void {
  const { threads, threadsWindow, slotRect, speechPlayback, locomotion, renderer, settings } = deps;
  if (!threads || !threadsWindow) return () => {};
  const reaction = createThreadReaction({
    threads,
    enabled: settings.threadReactionsSettings,
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
  return reaction.dispose;
}
