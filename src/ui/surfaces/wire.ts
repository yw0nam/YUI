/** One Surfaces for every consumer — local DOM plus the message window over the bridge, routed by the stored mode. */

import { createMessageBridge } from "../../io/bridge/message/message-bridge";
import { createRemoteSurfaces, type RemoteSurfaces } from "../../io/bridge/message/message-remote";
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
import { isTauri } from "../../tauri-env";
import type { ToolStatus } from "../chips/status-pill";
import { createSpeechStream } from "./speech-stream";
import { createSurfaces, type Surfaces } from "./surfaces";
import { createSurfacesRouter } from "./surfaces-router";

export function wireMessageSurfaces(deps: {
  boundId?: string | null;
  settingsBridge: Pick<SettingsBridge, "emitSpeechStream">;
  transcript: { entriesAfterLastBoundary(): readonly ChatHistoryEntry[] };
  /** The name the backlog gives this window's character lines. */
  characterName(): string;
  mount: HTMLElement;
  tool: ToolStatus;
  bubblePersistSettings: Pick<SettingsStores["bubblePersistSettings"], "get">;
  messageWindowSettings: Pick<
    SettingsStores["messageWindowSettings"],
    "get" | "setMode" | "subscribe"
  >;
  register: (fn: () => void) => void;
}): {
  surfaces: Surfaces;
  local: Surfaces;
  remote: RemoteSurfaces | null;
  getMode(): MessageWindowMode;
} {
  const local = createSurfaces({
    mount: deps.mount,
    tool: deps.tool,
    keepBubbleUntilDismissed: () => deps.bubblePersistSettings.get().enabled,
    onPop: isTauri() ? () => deps.messageWindowSettings.setMode("popped") : undefined,
    namePlate: true,
    backlog: { read: deps.transcript.entriesAfterLastBoundary, characterName: deps.characterName },
  });
  const messageBridge = createMessageBridge(undefined, { windowKind: "pet" });
  const remote = createRemoteSurfaces(messageBridge);
  // A stale popped mode must not strand speech in a window the browser build cannot open.
  const getMode = (): MessageWindowMode =>
    isTauri() ? deps.messageWindowSettings.get().mode : "docked";
  const stream = createSpeechStream({
    presetId: deps.boundId ?? presetIdForWindow(),
    emit: deps.settingsBridge.emitSpeechStream,
    readTranscript: deps.transcript.entriesAfterLastBoundary,
  });
  const surfaces = createSurfacesRouter({
    local,
    remote,
    stream,
    getMode,
    subscribeMode: (cb) => deps.messageWindowSettings.subscribe(() => cb(getMode())),
  });
  const disposeMessageWindowMode = wireMessageWindowMode({
    store: deps.messageWindowSettings,
    remote,
    window: createMessageWindowController(deps.messageWindowSettings, deps.boundId),
    listenTrayToggle: deps.boundId == null ? listenTrayToggle : undefined,
    getMode,
  });
  deps.register(() => messageBridge.dispose());
  deps.register(() => surfaces.dispose());
  deps.register(disposeMessageWindowMode);
  return { surfaces, local, remote, getMode };
}
