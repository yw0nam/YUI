/**
 * The message window as the pet window sees it — the bubble and input half of
 * `Surfaces`, backed by the bridge instead of local DOM.
 *
 * The error action's callback cannot cross the wire, so only its label travels
 * and the click comes back as `input-error-action`. The limits and the busy
 * state are held here so a window created after the fact can ask for them with
 * `ready` and catch up.
 */

import type { AttachmentLimits } from "../config";
import type { InputErrorAction } from "../ui/text-input";
import type { MessageBridge } from "./message-bridge";

/** The half of `Surfaces` the message window owns, plus the dock request it can raise. */
export interface RemoteSurfaces {
  beginSpeech(): void;
  pushSpeech(delta: string): void;
  endSpeech(opts?: { defer?: boolean }): void;
  finishSpeech(): void;
  hideSpeech(): void;
  summonInput(): void;
  dismissInput(): void;
  /** The last open state the message window reported. */
  isInputOpen(): boolean;
  setInputEnabled(enabled: boolean): void;
  setBusy(busy: boolean): void;
  showInputError(message: string, action?: InputErrorAction): void;
  setAttachmentLimits(limits: AttachmentLimits): void;
  onSubmit(cb: (text: string, images: string[]) => void): void;
  onStop(cb: () => void): void;
  /** The ⤓ button on the message window's plate. */
  onDock(cb: () => void): void;
  dispose(): void;
}

export function createRemoteSurfaces(bridge: MessageBridge): RemoteSurfaces {
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  const dockHandlers: Array<() => void> = [];
  let inputOpen = false;
  let busy = false;
  let limits: AttachmentLimits | null = null;
  let pendingErrorAction: (() => void) | null = null;

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
      bridge.emitSurface({ op: "hide" });
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
    setInputEnabled(enabled) {
      bridge.emitSurface({ op: "input-enabled", enabled });
    },
    setBusy(value) {
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
    setAttachmentLimits(next) {
      limits = next;
      bridge.emitSurface({ op: "attachment-limits", limits: next });
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
    dispose() {
      unlisten();
      submitHandlers.length = 0;
      stopHandlers.length = 0;
      dockHandlers.length = 0;
      pendingErrorAction = null;
    },
  };
}
