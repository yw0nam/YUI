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
import type { UtteranceIdentity } from "../../../contract";
import { createLogger } from "../../../logger";
import type { AskAnswer, AskFrame, BackendCommand } from "../../chat/push/push-frames";
import type {
  CommandReplyState,
  MessageBridge,
  MessageSurfaceOp,
  SourceLine,
  UserQuote,
} from "./message-bridge";

/** Streamed deltas leave the remote window at most every 40 ms. */
const COALESCE_MS = 40;

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

export function createRemoteSurfaces(bridge: MessageBridge): RemoteSurfaces {
  const log = createLogger("message-remote");
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  const dockHandlers: Array<() => void> = [];
  const openSettingsHandlers: Array<() => void> = [];
  const commandReplyCloseHandlers: Array<() => void> = [];
  const commandHandlers: Array<(name: string, args: string) => boolean> = [];
  const askAnswerHandlers: Array<(answer: AskAnswer) => boolean> = [];
  let asks: AskFrame[] | null = null;
  let commands: BackendCommand[] | null = null;
  let reply: CommandReplyState | null = null;
  let inputOpen = false;
  let busy = false;
  let name: string | null = null;
  let limits: AttachmentLimits | null = null;
  let pendingErrorAction: (() => void) | null = null;
  let speechActionClicks: Array<() => void> = [];
  let heldDelta = "";
  let coalesceTimer: ReturnType<typeof setTimeout> | undefined;

  /** Sends the held deltas now and drops the timer that would have sent them. */
  const flush = (): void => {
    if (coalesceTimer !== undefined) clearTimeout(coalesceTimer);
    coalesceTimer = undefined;
    if (!heldDelta) return;
    const delta = heldDelta;
    heldDelta = "";
    bridge.emitSurface({ op: "push", delta });
  };

  /** Holds the streamed deltas for one tick; every other op goes out behind them. */
  const emit = (op: MessageSurfaceOp): void => {
    if (op.op === "push") {
      if (!op.delta) return;
      heldDelta += op.delta;
      coalesceTimer ??= setTimeout(flush, COALESCE_MS);
      return;
    }
    flush();
    bridge.emitSurface(op);
  };

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
        if (asks !== null) emit({ op: "asks", frames: asks });
        if (commands !== null) emit({ op: "commands", commands });
        if (reply !== null) emit({ op: "command-reply", reply });
        if (limits) emit({ op: "attachment-limits", limits });
        if (name !== null) emit({ op: "name", name });
        emit({ op: "busy", busy });
        break;
      default: {
        const unhandled: never = op;
        void unhandled;
      }
    }
  });

  return {
    setAsks(frames) {
      asks = frames;
      emit({ op: "asks", frames });
    },
    onAskAnswer(cb) {
      askAnswerHandlers.push(cb);
    },
    setCommands(list) {
      commands = list;
      emit({ op: "commands", commands });
    },
    showCommandReply(value) {
      reply = value;
      emit({ op: "command-reply", reply });
    },
    onCommandReplyClose(cb) {
      commandReplyCloseHandlers.push(cb);
    },
    onCommand(cb) {
      commandHandlers.push(cb);
    },
    beginSpeech() {
      speechActionClicks = [];
      emit({ op: "begin" });
    },
    pushSpeech(delta) {
      emit({ op: "push", delta });
    },
    endSpeech(opts) {
      emit(opts?.defer ? { op: "end", defer: true } : { op: "end" });
    },
    finishSpeech() {
      emit({ op: "finish" });
    },
    hideSpeech() {
      speechActionClicks = [];
      emit({ op: "hide" });
    },
    quoteUser(quote) {
      emit({ op: "quote", quote });
    },
    quoteSignals(lines) {
      emit({ op: "quote-signals", lines });
    },
    settleQuote() {
      emit({ op: "settle-quote" });
    },
    clearQuote() {
      emit({ op: "clear-quote" });
    },
    summonInput() {
      emit({ op: "summon-input" });
    },
    dismissInput() {
      emit({ op: "dismiss-input" });
    },
    isInputOpen() {
      return inputOpen;
    },
    setName(value) {
      name = value;
      emit({ op: "name", name: value });
    },
    setBusy(value) {
      log.info("busy_emit", { busy: value });
      busy = value;
      emit({ op: "busy", busy: value });
    },
    showInputError(message, action) {
      pendingErrorAction = action?.onClick ?? null;
      emit(
        action
          ? { op: "input-error", message, action: { label: action.label } }
          : { op: "input-error", message },
      );
    },
    showSpeechActions(actions) {
      speechActionClicks = actions.map((a) => a.onClick);
      emit({
        op: "speech-actions",
        actions: actions.map(({ label, busy }) => (busy ? { label, busy } : { label })),
      });
    },
    setAttachmentLimits(next) {
      limits = next;
      emit({ op: "attachment-limits", limits: next });
    },
    restoreInput(text, images) {
      emit({ op: "restore-input", text, images });
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
      flush();
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
