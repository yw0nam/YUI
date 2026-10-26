/**
 * One Surfaces selects the local pet or remote message window for speech and input. While the
 * unified chat window shows, the character's chat — its lines, asides, quotes and input — goes to
 * the speech stream instead, and only notices stay on the character's own bubble. Tool status, the
 * feet anchor and the overlay element stay local because they belong to the character. Submit and
 * stop callbacks register once and fire from whichever side the user types on.
 */

import type { RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";
import type { UnifiedShown } from "../../settings/unified/unified-chat-switch";
import type { Surfaces } from "./surfaces";

interface SurfacesRouterOptions {
  local: Surfaces;
  remote: RemoteSurfaces;
  /** The speech stream to the unified chat window. */
  stream: RemoteSurfaces;
  getMode(): MessageWindowMode;
  subscribeMode(cb: (mode: MessageWindowMode) => void): () => void;
  shown: UnifiedShown;
}

type SpeechSide = Pick<
  Surfaces,
  | "beginSpeech"
  | "pushSpeech"
  | "paceSpeech"
  | "endSpeech"
  | "finishSpeech"
  | "hideSpeech"
  | "quoteUser"
  | "quoteSignals"
  | "settleQuote"
  | "clearQuote"
>;

type LineSide = Pick<
  Surfaces,
  "beginSpeech" | "pushSpeech" | "paceSpeech" | "endSpeech" | "finishSpeech" | "hideSpeech"
>;

export function createSurfacesRouter({
  local,
  remote,
  stream,
  getMode,
  subscribeMode,
  shown,
}: SurfacesRouterOptions): Surfaces {
  const speech = (): SpeechSide & Pick<Surfaces, "showSpeechAction"> =>
    getMode() === "popped" ? remote : local;
  const input = (): Pick<
    Surfaces,
    "summonInput" | "dismissInput" | "isInputOpen" | "showInputError" | "restoreInput"
  > => (getMode() === "popped" ? remote : local);
  // The side the current line began on: the stream, the pet side (local or remote by the mode), or none once dropped.
  let lineSide: "stream" | "pet" | "none" = "pet";
  let chatLine = false;
  const noLine: LineSide = {
    beginSpeech() {},
    pushSpeech() {},
    paceSpeech() {},
    endSpeech() {},
    finishSpeech() {},
    hideSpeech() {},
  };
  const line = (): LineSide =>
    lineSide === "stream" ? stream : lineSide === "pet" ? speech() : noLine;
  const quote = (): SpeechSide => (shown.get() ? stream : speech());

  // Speech left behind on the side being abandoned would hang there with nothing to dismiss it,
  // and a typing session follows the user across rather than closing under them.
  // The store also carries the window position, so only a real mode change moves anything.
  let lastMode = getMode();
  const unsubscribeMode = subscribeMode((mode) => {
    if (mode === lastMode) return;
    lastMode = mode;
    // The unified window takes over the input, so nothing is carried across.
    if (shown.get()) return;
    const left: Pick<Surfaces, "hideSpeech" | "isInputOpen" | "dismissInput"> =
      mode === "popped" ? local : remote;
    const entered: Pick<Surfaces, "summonInput"> = mode === "popped" ? remote : local;
    left.hideSpeech();
    if (left.isInputOpen()) {
      left.dismissInput();
      entered.summonInput();
    }
  });
  const unsubscribeShown = shown.subscribe((on) => {
    if (!on) return;
    // A chat line already under way on the character's bubble shows from its next line, in the unified window.
    if (lineSide === "pet" && chatLine) lineSide = "none";
    for (const side of [local, remote]) {
      side.hideSpeech();
      if (side.isInputOpen()) side.dismissInput();
    }
  });

  return {
    el: local.el,
    chipColumn: local.chipColumn,

    beginSpeech(...args) {
      chatLine = args[0] !== undefined || args[1]?.aside === true;
      lineSide = shown.get() && chatLine ? "stream" : "pet";
      line().beginSpeech(...args);
    },
    pushSpeech: (...args) => line().pushSpeech(...args),
    paceSpeech: (sentence) => line().paceSpeech(sentence),
    endSpeech: (...args) => line().endSpeech(...args),
    finishSpeech: () => line().finishSpeech(),
    hideSpeech: () => line().hideSpeech(),
    showSpeechAction: (action) => speech().showSpeechAction(action),
    quoteUser: (q) => quote().quoteUser(q),
    quoteSignals: (lines) => quote().quoteSignals(lines),
    settleQuote: () => quote().settleQuote(),
    clearQuote: () => quote().clearQuote(),

    showTool: local.showTool,
    finishTool: local.finishTool,
    hideTool: local.hideTool,

    // The unified composer is always open, so it takes the summons and the errors; there is nothing to dismiss or restore.
    summonInput: () => (shown.get() ? stream : input()).summonInput(),
    dismissInput() {
      if (!shown.get()) input().dismissInput();
    },
    isInputOpen: () => shown.get() || input().isInputOpen(),
    // Busy goes everywhere, so the side a mode flip reveals is current and a late unified window can ask for it.
    setBusy(busy) {
      local.setBusy(busy);
      remote.setBusy(busy);
      stream.setBusy(busy);
    },
    showInputError: (message, action) =>
      (shown.get() ? stream : input()).showInputError(message, action),
    restoreInput(text, images) {
      if (!shown.get()) input().restoreInput(text, images);
    },
    setAttachmentLimits(limits) {
      local.setAttachmentLimits(limits);
      remote.setAttachmentLimits(limits);
    },

    onSubmit(cb) {
      local.onSubmit(cb);
      remote.onSubmit(cb);
    },
    onStop(cb) {
      local.onStop(cb);
      remote.onStop(cb);
    },

    setInputAnchor: local.setInputAnchor,

    dispose() {
      unsubscribeMode();
      unsubscribeShown();
      remote.dispose();
      local.dispose();
    },
  };
}
