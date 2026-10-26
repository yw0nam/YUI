/**
 * One Surfaces for every consumer — local DOM, the message window over the bridge, and the speech
 * stream to the unified chat window, routed by the stored mode and whether the unified window shows.
 */

import { createMessageBridge } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces, type RemoteSurfaces } from "../../io/bridge/message/message-remote";
import { createStreamBridge } from "../../io/bridge/message/stream-bridge";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import {
  createMessageWindowController,
  listenTrayToggle,
} from "../../io/window/openers/message-window";
import { wireMessageWindowMode } from "../../io/window/openers/message-window-mode";
import type { MessageWindowMode } from "../../settings/panels/message-window-settings";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import type { SettingsStores } from "../../settings/settings-stores";
import type { UnifiedShown } from "../../settings/unified/unified-chat-switch";
import { isTauri } from "../../tauri-env";
import type { ToolStatus } from "../chips/status-pill";
import { transcriptBacklog } from "../message/backlog";
import type { MessagePlate } from "../message/message-plate";
import { createSurfaces, type Surfaces } from "./surfaces";
import { createSurfacesRouter } from "./surfaces-router";

export function wireMessageSurfaces(deps: {
  boundId?: string | null;
  settingsBridge: Pick<
    SettingsBridge,
    "emitSpeechStream" | "onSpeechStreamAsk" | "onSpeechStreamControl"
  >;
  transcript: { entriesAfterLastBoundary(): readonly ChatHistoryEntry[] };
  /** The character's name, for the backlog's lines here and the message window's plate and backlog. */
  characterName: { get(): string; subscribe(cb: () => void): () => void };
  mount: HTMLElement;
  tool: ToolStatus;
  bubblePersistSettings: Pick<SettingsStores["bubblePersistSettings"], "get">;
  messageWindowSettings: Pick<
    SettingsStores["messageWindowSettings"],
    "get" | "setMode" | "subscribe"
  >;
  /** While it shows, chat goes to the unified chat window and the message window hides. */
  shown: UnifiedShown;
  register: (fn: () => void) => void;
}): {
  surfaces: Surfaces;
  local: Surfaces & { readonly plate: MessagePlate };
  remote: RemoteSurfaces | null;
  getMode(): MessageWindowMode;
  /** Follows every change getMode can make. */
  subscribeMode(cb: () => void): () => void;
} {
  const local = createSurfaces({
    mount: deps.mount,
    tool: deps.tool,
    keepBubbleUntilDismissed: () => deps.bubblePersistSettings.get().enabled,
    onPop: isTauri() ? () => deps.messageWindowSettings.setMode("popped") : undefined,
    namePlate: true,
    backlog: transcriptBacklog(deps.transcript.entriesAfterLastBoundary, deps.characterName.get),
  });
  const messageBridge = createMessageBridge(undefined, { windowKind: "pet" });
  const remote = createRemoteSurfaces(messageBridge);
  const stream = createRemoteSurfaces(
    createStreamBridge({
      presetId: deps.boundId ?? presetIdForWindow(),
      settingsBridge: deps.settingsBridge,
    }),
  );
  const sendName = (): void => {
    remote.setName(deps.characterName.get());
    stream.setName(deps.characterName.get());
  };
  sendName();
  // A stale popped mode must not strand speech in a window the browser build cannot open.
  const getMode = (): MessageWindowMode =>
    isTauri() && !deps.shown.get() ? deps.messageWindowSettings.get().mode : "docked";
  const subscribeMode = (cb: () => void): (() => void) => {
    const offStore = deps.messageWindowSettings.subscribe(cb);
    const offShown = deps.shown.subscribe(cb);
    return () => {
      offStore();
      offShown();
    };
  };
  const surfaces = createSurfacesRouter({
    local,
    remote,
    stream,
    getMode,
    subscribeMode: (cb) => subscribeMode(() => cb(getMode())),
    shown: deps.shown,
  });
  const disposeMessageWindowMode = wireMessageWindowMode({
    store: deps.messageWindowSettings,
    remote,
    window: createMessageWindowController(deps.messageWindowSettings, deps.boundId),
    listenTrayToggle: deps.boundId == null ? listenTrayToggle : undefined,
    shown: deps.shown,
    getMode,
  });
  deps.register(deps.characterName.subscribe(sendName));
  deps.register(() => messageBridge.dispose());
  deps.register(() => surfaces.dispose());
  deps.register(() => stream.dispose());
  deps.register(disposeMessageWindowMode);
  return { surfaces, local, remote, getMode, subscribeMode };
}
