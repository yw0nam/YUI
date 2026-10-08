/**
 * The message window as the pet window sees it — the bubble and input half of
 * `Surfaces`, backed by the bridge instead of local DOM.
 *
 * An action's callback cannot cross the wire, so only its label travels and the
 * click comes back as `input-error-action` / `speech-action`. The limits and the busy
 * state are held here so a window created after the fact can ask for them with
 * `ready` and catch up.
 */

import type { AttachmentLimits } from "../../../config/validators/guardrails";
import { createLogger } from "../../../logger";
import type { MessageBridge, UserQuote } from "./message-bridge";

/** In-place fix offered next to an inline error (e.g. "Open Advanced" on an unconfigured backend). */
export interface InputErrorAction {
  label: string;
  onClick(): void;
}

/** In-place fix offered under the speech text (e.g. "Open Connection" on an unconfigured backend). */
export interface SpeechAction {
  label: string;
  onClick(): void;
}

/** The half of `Surfaces` the message window owns, plus the dock request it can raise. */
export interface RemoteSurfaces {
  beginSpeech(): void;
  pushSpeech(delta: string): void;
  endSpeech(opts?: { defer?: boolean }): void;
  finishSpeech(): void;
  hideSpeech(): void;
  /** Opens the message window's bubble with the user's message quoted on its first line. */
  quoteUser(quote: UserQuote): void;
  /** Hands the quoted turn's bubble to its dwell. */
  settleQuote(): void;
  /** Drops the quoted line from the message window's bubble. */
  clearQuote(): void;
  summonInput(): void;
  dismissInput(): void;
  /** The last open state the message window reported. */
  isInputOpen(): boolean;
  setBusy(busy: boolean): void;
  showInputError(message: string, action?: InputErrorAction): void;
  /** Offers an in-place fix under the current speech; without an action, drops the one shown. */
  showSpeechAction(action?: SpeechAction): void;
  setAttachmentLimits(limits: AttachmentLimits): void;
  /** Puts a sent message back into the message window's composer when it is open and empty. */
  restoreInput(text: string, images: string[]): void;
  onSubmit(cb: (text: string, images: string[]) => void): void;
  onStop(cb: () => void): void;
  /** The dock button on the message window's plate. */
  onDock(cb: () => void): void;
  /** A surface in the message window asking for the settings panel. */
  onOpenSettings(cb: () => void): void;
  dispose(): void;
}

export function createRemoteSurfaces(bridge: MessageBridge): RemoteSurfaces {
  const log = createLogger("message-remote");
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  const dockHandlers: Array<() => void> = [];
  const openSettingsHandlers: Array<() => void> = [];
  let inputOpen = false;
  let busy = false;
  let limits: AttachmentLimits | null = null;
  let pendingErrorAction: (() => void) | null = null;
  let pendingSpeechAction: (() => void) | null = null;

  const unlisten = bridge.onControl((op) => {
    switch (op.op) {
      case "submit":
        for (const cb of submitHandlers) cb(op.text, op.images);
        break;
      case "stop":
        for (const cb of stopHandlers) cb();
        break;
      case "input-open":
        inputOpen = op.open;
        break;
      case "input-error-action":
        pendingErrorAction?.();
        break;
      case "speech-action":
        pendingSpeechAction?.();
        break;
      case "open-settings":
        for (const cb of openSettingsHandlers) cb();
        break;
      case "dock":
        for (const cb of dockHandlers) cb();
        break;
      case "ready":
        if (limits) bridge.emitSurface({ op: "attachment-limits", limits });
        bridge.emitSurface({ op: "busy", busy });
        break;
      default: {
        const unhandled: never = op;
        void unhandled;
      }
    }
  });

  return {
    beginSpeech() {
      pendingSpeechAction = null;
      bridge.emitSurface({ op: "begin" });
    },
    pushSpeech(delta) {
      bridge.emitSurface({ op: "push", delta });
    },
    endSpeech(opts) {
      bridge.emitSurface(opts?.defer ? { op: "end", defer: true } : { op: "end" });
    },
    finishSpeech() {
      bridge.emitSurface({ op: "finish" });
    },
    hideSpeech() {
      pendingSpeechAction = null;
      bridge.emitSurface({ op: "hide" });
    },
    quoteUser(quote) {
      bridge.emitSurface({ op: "quote", quote });
    },
    settleQuote() {
      bridge.emitSurface({ op: "settle-quote" });
    },
    clearQuote() {
      bridge.emitSurface({ op: "clear-quote" });
    },
    summonInput() {
      bridge.emitSurface({ op: "summon-input" });
    },
    dismissInput() {
      bridge.emitSurface({ op: "dismiss-input" });
    },
    isInputOpen() {
      return inputOpen;
    },
    setBusy(value) {
      log.info("busy_emit", { busy: value });
      busy = value;
      bridge.emitSurface({ op: "busy", busy: value });
    },
    showInputError(message, action) {
      pendingErrorAction = action?.onClick ?? null;
      bridge.emitSurface(
        action
          ? { op: "input-error", message, action: { label: action.label } }
          : { op: "input-error", message },
      );
    },
    showSpeechAction(action) {
      pendingSpeechAction = action?.onClick ?? null;
      bridge.emitSurface(
        action ? { op: "speech-action", action: { label: action.label } } : { op: "speech-action" },
      );
    },
    setAttachmentLimits(next) {
      limits = next;
      bridge.emitSurface({ op: "attachment-limits", limits: next });
    },
    restoreInput(text, images) {
      bridge.emitSurface({ op: "restore-input", text, images });
    },
    onSubmit(cb) {
      submitHandlers.push(cb);
    },
    onStop(cb) {
      stopHandlers.push(cb);
    },
    onDock(cb) {
      dockHandlers.push(cb);
    },
    onOpenSettings(cb) {
      openSettingsHandlers.push(cb);
    },
    dispose() {
      unlisten();
      submitHandlers.length = 0;
      stopHandlers.length = 0;
      dockHandlers.length = 0;
      openSettingsHandlers.length = 0;
      pendingErrorAction = null;
      pendingSpeechAction = null;
    },
  };
}
