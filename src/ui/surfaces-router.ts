/**
 * One `Surfaces` over two destinations — the pet window's own surfaces and the
 * message window's, reached over the bridge.
 *
 * Every consumer keeps its single `Surfaces` handle: the router picks the side
 * the current mode names for the bubble and the input, and keeps the tool chip,
 * the feet anchor and the overlay element local, since those belong to the
 * character. Submit and stop callbacks are registered once here and fire
 * whichever side the user typed on.
 */

import type { RemoteSurfaces } from "../io/message-remote";
import type { MessageWindowMode } from "../io/message-window-settings";
import type { Surfaces } from "./surfaces";

export interface SurfacesRouterOptions {
  local: Surfaces;
  remote: RemoteSurfaces;
  getMode(): MessageWindowMode;
  subscribeMode(cb: (mode: MessageWindowMode) => void): () => void;
}

export function createSurfacesRouter({
  local,
  remote,
  getMode,
  subscribeMode,
}: SurfacesRouterOptions): Surfaces {
  const speech = (): Pick<
    Surfaces,
    "beginSpeech" | "pushSpeech" | "endSpeech" | "finishSpeech" | "hideSpeech"
  > => (getMode() === "popped" ? remote : local);
  const input = (): Pick<
    Surfaces,
    | "summonInput"
    | "dismissInput"
    | "isInputOpen"
    | "setInputEnabled"
    | "setBusy"
    | "showInputError"
    | "setAttachmentLimits"
  > => (getMode() === "popped" ? remote : local);

  // Speech left behind on the side being abandoned would hang there with nothing to dismiss it.
  // The store also carries the window position, so only a real mode change moves anything.
  let lastMode = getMode();
  const unsubscribeMode = subscribeMode((mode) => {
    if (mode === lastMode) return;
    lastMode = mode;
    if (mode === "popped") local.hideSpeech();
    else remote.hideSpeech();
  });

  return {
    el: local.el,

    beginSpeech: () => speech().beginSpeech(),
    pushSpeech: (delta) => speech().pushSpeech(delta),
    endSpeech: (opts) => speech().endSpeech(opts),
    finishSpeech: () => speech().finishSpeech(),
    hideSpeech: () => speech().hideSpeech(),

    showTool: local.showTool,
    finishTool: local.finishTool,
    hideTool: local.hideTool,

    summonInput: () => input().summonInput(),
    dismissInput: () => input().dismissInput(),
    isInputOpen: () => input().isInputOpen(),
    setInputEnabled: (enabled) => input().setInputEnabled(enabled),
    setBusy: (busy) => input().setBusy(busy),
    showInputError: (message, action) => input().showInputError(message, action),
    setAttachmentLimits: (limits) => input().setAttachmentLimits(limits),

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
