/**
 * One Surfaces selects the local pet or remote message window for speech and input, and also
 * sends identified speech to the unified stream. Tool status, the feet anchor and the overlay
 * element stay local because they belong to the character. Submit and stop callbacks register
 * once and fire from whichever side the user types on.
 */

import type { RemoteSurfaces } from "../../io/bridge/message/message-remote";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";
import type { SpeechSurfaces, Surfaces } from "./surfaces";

interface SurfacesRouterOptions {
  local: Surfaces;
  remote: RemoteSurfaces;
  stream: SpeechSurfaces;
  getMode(): MessageWindowMode;
  subscribeMode(cb: (mode: MessageWindowMode) => void): () => void;
}

export function createSurfacesRouter({
  local,
  remote,
  stream,
  getMode,
  subscribeMode,
}: SurfacesRouterOptions): Surfaces {
  const speech = (): Pick<
    Surfaces,
    | "beginSpeech"
    | "pushSpeech"
    | "endSpeech"
    | "finishSpeech"
    | "hideSpeech"
    | "showSpeechAction"
    | "quoteUser"
    | "quoteSignals"
    | "settleQuote"
    | "clearQuote"
  > => (getMode() === "popped" ? remote : local);
  const input = (): Pick<
    Surfaces,
    "summonInput" | "dismissInput" | "isInputOpen" | "showInputError" | "restoreInput"
  > => (getMode() === "popped" ? remote : local);

  // Speech left behind on the side being abandoned would hang there with nothing to dismiss it,
  // and a typing session follows the user across rather than closing under them.
  // The store also carries the window position, so only a real mode change moves anything.
  let lastMode = getMode();
  const unsubscribeMode = subscribeMode((mode) => {
    if (mode === lastMode) return;
    lastMode = mode;
    const left: Pick<Surfaces, "hideSpeech" | "isInputOpen" | "dismissInput"> =
      mode === "popped" ? local : remote;
    const entered: Pick<Surfaces, "summonInput"> = mode === "popped" ? remote : local;
    left.hideSpeech();
    if (left.isInputOpen()) {
      left.dismissInput();
      entered.summonInput();
    }
  });

  return {
    el: local.el,
    chipColumn: local.chipColumn,

    beginSpeech(...args) {
      speech().beginSpeech(...args);
      stream.beginSpeech(...args);
    },
    pushSpeech(...args) {
      speech().pushSpeech(...args);
      stream.pushSpeech(...args);
    },
    endSpeech(...args) {
      speech().endSpeech(...args);
      stream.endSpeech(...args);
    },
    finishSpeech: () => speech().finishSpeech(),
    hideSpeech: () => speech().hideSpeech(),
    showSpeechAction: (action) => speech().showSpeechAction(action),
    quoteUser: (quote) => speech().quoteUser(quote),
    quoteSignals: (lines) => speech().quoteSignals(lines),
    settleQuote: () => speech().settleQuote(),
    clearQuote: () => speech().clearQuote(),

    showTool: local.showTool,
    finishTool: local.finishTool,
    hideTool: local.hideTool,

    summonInput: () => input().summonInput(),
    dismissInput: () => input().dismissInput(),
    isInputOpen: () => input().isInputOpen(),
    // Busy and the attachment limits go to both sides, so the side a mode flip reveals is current.
    setBusy(busy) {
      local.setBusy(busy);
      remote.setBusy(busy);
    },
    showInputError: (message, action) => input().showInputError(message, action),
    restoreInput: (text, images) => input().restoreInput(text, images),
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
      remote.dispose();
      local.dispose();
    },
  };
}
