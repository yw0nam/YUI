/**
 * Pet-side mode wiring — keeps the message window's existence in step with the
 * stored mode, the dock request and the tray's show/hide of the character.
 */

import type { RemoteSurfaces } from "./message-remote";
import type { MessageWindowMode, MessageWindowSettingsStore } from "./message-window-settings";

export interface MessageWindowModeDeps {
  store: MessageWindowSettingsStore;
  remote: Pick<RemoteSurfaces, "onDock">;
  /** Show/hide handle for the message window. */
  window: { open(): void; hide(): void };
  /** Pet-window tray visibility, when the runtime can report it. */
  listenTrayToggle?: (cb: (visible: boolean) => void) => () => void;
  /** The effective mode — pinned to docked where there is no second window. */
  getMode(): MessageWindowMode;
}

export function wireMessageWindowMode({
  store,
  remote,
  window: messageWindow,
  listenTrayToggle,
  getMode,
}: MessageWindowModeDeps): () => void {
  const apply = (mode: MessageWindowMode): void => {
    if (mode === "popped") messageWindow.open();
    else messageWindow.hide();
  };

  apply(getMode());
  const unsubscribe = store.subscribe(() => apply(getMode()));
  remote.onDock(() => store.setMode("docked"));
  // The character's own hide takes the message window with it; showing brings back only what was popped.
  const unlistenTray = listenTrayToggle?.((visible) => {
    if (!visible) messageWindow.hide();
    else apply(getMode());
  });

  return () => {
    unsubscribe();
    unlistenTray?.();
  };
}
