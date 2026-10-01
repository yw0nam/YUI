/**
 * The phone's voice capture intent — whether the mic should be on. Tap mode flips it on each press;
 * keep-listening mode holds it on while the app is in the foreground. The intent drives the voice
 * status the engine follows (listening starts capture, idle stops it); the engine's own failures
 * come back through that status and turn the intent off, and nothing retries by itself.
 */

import type { EndpointsConfig } from "../../../contract";
import type { PageVisibility } from "../../../io/lifecycle/page-visibility";
import { isMicErrorCode } from "../../../io/voice/mic-error";
import type { Logger } from "../../../logger";
import type { VoiceMode, VoiceModeStore } from "../../../settings/voice/voice-mode";
import type { VoiceInputStatus } from "../../../ui/chips/voice-input-status";

export interface VoiceController {
  /** Whether the mic should be on. */
  wanted(): boolean;
  /** Whether the mic is on and healthy: wanted and the status shows no error. */
  live(): boolean;
  /** Fires when the intent or the voice status changes. */
  subscribe(cb: () => void): () => void;
  /** The mic button: flip the intent, or open the STT settings when STT is not set up. */
  toggle(): void;
  /** The General tab's segment. Keep listening is saved once the capture has started. */
  selectMode(mode: VoiceMode): void;
  /** The engine's report that capture runs. */
  onCaptureStarted(): void;
  /** Applies the launch state once the config has loaded. */
  start(): void;
  dispose(): void;
}

export function createVoiceController(deps: {
  status: Pick<VoiceInputStatus, "get" | "set" | "subscribe">;
  mode: Pick<VoiceModeStore, "get" | "set">;
  visibility: Pick<PageVisibility, "get" | "subscribe">;
  getEndpoints: () => EndpointsConfig;
  openSttSettings: () => void;
  log: Logger;
}): VoiceController {
  const { status, mode, visibility, getEndpoints, openSttSettings, log } = deps;
  let on = false;
  let capturing = false;
  // Keep listening was picked and waits for the capture to start before it is saved.
  let pendingAlways = false;
  let started = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const cb of [...listeners]) cb();
  };
  const sttConfigured = (): boolean => Boolean(getEndpoints().stt_base_url);

  function setIntent(next: boolean, reason: string): void {
    if (!next) {
      capturing = false;
      pendingAlways = false;
    }
    if (on !== next) log.info("voice_intent", { on: next, reason });
    on = next;
    status.set(next ? "listening" : "idle");
    notify();
  }

  function enterForeground(reason: string): void {
    if (mode.get().mode === "always" && sttConfigured()) setIntent(true, reason);
  }

  const unsubscribeVisibility = visibility.subscribe(() => {
    if (!started) return;
    if (visibility.get()) setIntent(false, "background");
    else enterForeground("foreground");
  });

  // A start failure leaves the error on the status for the pill; only the intent goes off.
  const unsubscribeStatus = status.subscribe((snapshot) => {
    if (on && snapshot.state === "error" && isMicErrorCode(snapshot.detail)) {
      on = false;
      capturing = false;
      pendingAlways = false;
      log.info("voice_intent", { on: false, reason: snapshot.detail });
    }
    notify();
  });

  return {
    wanted: () => on,
    live: () => on && status.get().state !== "error",
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    toggle() {
      if (on) setIntent(false, "toggle");
      else if (sttConfigured()) setIntent(true, "toggle");
      else openSttSettings();
    },
    selectMode(next) {
      if (next === "tap") {
        mode.set("tap");
        setIntent(false, "select_tap");
        return;
      }
      if (!sttConfigured()) {
        openSttSettings();
        return;
      }
      if (on && capturing) {
        mode.set("always");
        return;
      }
      pendingAlways = true;
      setIntent(true, "select_always");
    },
    onCaptureStarted() {
      if (!on) return;
      capturing = true;
      if (pendingAlways) {
        pendingAlways = false;
        mode.set("always");
      }
    },
    start() {
      started = true;
      if (!visibility.get()) enterForeground("launch");
    },
    dispose() {
      unsubscribeVisibility();
      unsubscribeStatus();
      listeners.clear();
    },
  };
}
