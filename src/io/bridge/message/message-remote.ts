/**
 * The message window as the pet window sees it — the bubble and input half of
 * `Surfaces`, backed by the bridge instead of local DOM.
 *
 * An action's callback cannot cross the wire, so only its label travels and the
 * click comes back as `input-error-action` / `speech-action`. The sender built from
 * `surfaceOps` holds the replayed ops, so a window created after the fact can ask
 * for them with `ready` and catch up.
 */

import type { AttachmentLimits } from "../../../config/validators/guardrails";
import type { UtteranceIdentity } from "../../../contract";
import { createLogger } from "../../../logger";
import type { AskAnswer, AskFrame, BackendCommand } from "../../chat/push/push-frames";
import { createCoalescingBridge } from "./coalesce-pushes";
import type { CommandReplyState, MessageBridge, SourceLine, UserQuote } from "./message-bridge";
import { createSurfaceSender } from "./surface-ops";

/** In-place fix offered next to an inline error (e.g. "Open Advanced" on an unconfigured backend). */
export interface InputErrorAction {
  label: string;
  onClick(): void;
}

/** In-place fix offered under the speech text (e.g. "Open Connection" on an unconfigured backend). */
export interface SpeechAction {
  label: string;
  /** Shows disabled while its work runs; a click does nothing. */
  busy?: boolean;
  onClick(): void;
}

/** The half of `Surfaces` the message window owns, plus the dock request it can raise. */
export interface RemoteSurfaces {
  setAsks(frames: AskFrame[]): void;
  onAskAnswer(cb: (answer: AskAnswer) => boolean): void;
  setCommands(list: BackendCommand[]): void;
  showCommandReply(reply: CommandReplyState): void;
  onCommand(cb: (name: string, args: string) => boolean): void;
  onCommandReplyClose(cb: () => void): void;
  beginSpeech(identity?: UtteranceIdentity, opts?: { aside?: boolean }): void;
  pushSpeech(delta: string): void;
  endSpeech(opts?: { defer?: boolean }): void;
  finishSpeech(): void;
  hideSpeech(): void;
  /** Opens the message window's bubble with the user's message quoted on its first line. */
  quoteUser(quote: UserQuote): void;
  /** Shows the turn's signal groups as source lines on the message window's bubble. */
  quoteSignals(lines: SourceLine[]): void;
  /** Hands the quoted turn's bubble to its dwell. */
  settleQuote(): void;
  /** Drops the quoted line from the message window's bubble. */
  clearQuote(): void;
  summonInput(): void;
  dismissInput(): void;
  /** The last open state the message window reported. */
  isInputOpen(): boolean;
  setBusy(busy: boolean): void;
  /** The character's name the message window's plate and backlog show. */
  setName(name: string): void;
  showInputError(message: string, action?: InputErrorAction): void;
  /** Offers in-place buttons under the current speech; an empty list drops the ones shown. */
  showSpeechActions(actions: readonly SpeechAction[]): void;
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

export function createRemoteSurfaces(rawBridge: MessageBridge): RemoteSurfaces {
  const bridge = createCoalescingBridge(rawBridge);
  const log = createLogger("message-remote");
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  const dockHandlers: Array<() => void> = [];
  const openSettingsHandlers: Array<() => void> = [];
  const commandReplyCloseHandlers: Array<() => void> = [];
  const commandHandlers: Array<(name: string, args: string) => boolean> = [];
  const askAnswerHandlers: Array<(answer: AskAnswer) => boolean> = [];
  let inputOpen = false;
  let pendingErrorAction: (() => void) | null = null;
  let speechActionClicks: Array<() => void> = [];

  const sender = createSurfaceSender((op) => bridge.emitSurface(op));

  const unlisten = bridge.onControl((op) => {
    switch (op.op) {
      case "ask-answer":
        for (const cb of askAnswerHandlers) cb(op.answer);
        break;
      case "command-reply-close":
        for (const cb of commandReplyCloseHandlers) cb();
        break;
      case "command":
        for (const cb of commandHandlers) cb(op.name, op.args);
        break;
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
        speechActionClicks[op.index]?.();
        break;
      case "open-settings":
        for (const cb of openSettingsHandlers) cb();
        break;
      case "dock":
        for (const cb of dockHandlers) cb();
        break;
      case "ready":
        sender.replay();
        break;
      default: {
        const unhandled: never = op;
        void unhandled;
      }
    }
  });

  return {
    ...sender.methods,
    onAskAnswer(cb) {
      askAnswerHandlers.push(cb);
    },
    onCommandReplyClose(cb) {
      commandReplyCloseHandlers.push(cb);
    },
    onCommand(cb) {
      commandHandlers.push(cb);
    },
    beginSpeech() {
      speechActionClicks = [];
      sender.methods.beginSpeech();
    },
    hideSpeech() {
      speechActionClicks = [];
      sender.methods.hideSpeech();
    },
    isInputOpen() {
      return inputOpen;
    },
    setBusy(value) {
      log.info("busy_emit", { busy: value });
      sender.methods.setBusy(value);
    },
    showInputError(message, action) {
      pendingErrorAction = action?.onClick ?? null;
      sender.methods.showInputError(message, action);
    },
    showSpeechActions(actions) {
      speechActionClicks = actions.map((a) => a.onClick);
      sender.methods.showSpeechActions(actions);
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
      bridge.flush();
      unlisten();
      submitHandlers.length = 0;
      commandHandlers.length = 0;
      commandReplyCloseHandlers.length = 0;
      stopHandlers.length = 0;
      dockHandlers.length = 0;
      openSettingsHandlers.length = 0;
      pendingErrorAction = null;
      speechActionClicks = [];
    },
  };
}
