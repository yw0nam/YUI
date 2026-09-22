/** One Surfaces for every consumer — local DOM plus the message window over the bridge, routed by the stored mode. */

import { createMessageBridge } from "../../io/bridge/message-bridge";
import { createRemoteSurfaces, type RemoteSurfaces } from "../../io/bridge/message-remote";
import {
  createMessageWindowController,
  listenTrayToggle,
} from "../../io/window/openers/message-window";
import { wireMessageWindowMode } from "../../io/window/openers/message-window-mode";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import { createSurfaces, type Surfaces } from "./surfaces";
import { createSurfacesRouter } from "./surfaces-router";

export function wireMessageSurfaces(deps: {
  mount: HTMLElement;
  bubblePersistSettings: Pick<SettingsStores["bubblePersistSettings"], "get">;
  messageWindowSettings: Pick<
    SettingsStores["messageWindowSettings"],
    "get" | "setMode" | "subscribe"
  >;
  register: (fn: () => void) => void;
}): {
  surfaces: Surfaces;
  local: Surfaces;
  remote: RemoteSurfaces;
  getMode(): MessageWindowMode;
} {
  const local = createSurfaces({
    mount: deps.mount,
    keepBubbleUntilDismissed: () => deps.bubblePersistSettings.get().enabled,
    onPop: () => deps.messageWindowSettings.setMode("popped"),
  });
  const messageBridge = createMessageBridge(undefined, { windowKind: "pet" });
  const remote = createRemoteSurfaces(messageBridge);
  // A stale popped mode must not strand speech in a window the browser build cannot open.
  const getMode = (): MessageWindowMode =>
    isTauri() ? deps.messageWindowSettings.get().mode : "docked";
  const surfaces = createSurfacesRouter({
    local,
    remote,
    getMode,
    subscribeMode: (cb) => deps.messageWindowSettings.subscribe(() => cb(getMode())),
  });
  const disposeMessageWindowMode = wireMessageWindowMode({
    store: deps.messageWindowSettings,
    remote,
    window: createMessageWindowController(deps.messageWindowSettings),
    listenTrayToggle,
    getMode,
  });
  deps.register(() => messageBridge.dispose());
  deps.register(() => surfaces.dispose());
  deps.register(disposeMessageWindowMode);
  return { surfaces, local, remote, getMode };
}
