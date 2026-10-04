import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import { type ConversationStores, conversationSyncStores } from "../settings/conversation-stores";
import { wireWindowSync } from "./wire-window-sync";

/**
 * Pet-window cross-window sync: the shared core plus the channels only this window owns — mouth
 * preview and the voice toggle/state pair, which ride the same bridge. `broadcastSettings` goes to
 * the VRM/speaker selections and `onRemoteChange` to `wireSettingsReload`, both wired by the caller
 * once those selections exist.
 */
export function wireCrossWindowSync(deps: {
  renderer: Pick<Renderer, "setMouthOpen" | "stopMouth">;
  voiceInputStatus: VoiceInputStatus;
  stores: SettingsStores;
  conversation: ConversationStores;
  log: Logger;
}): {
  broadcastSettings: () => void;
  onRemoteChange: (cb: () => void) => void;
  /** The window's bus, for the channels this helper does not own itself. */
  bridge: SettingsBridge;
  dispose: () => void;
} {
  const { renderer, voiceInputStatus, stores, conversation, log } = deps;
  const core = wireWindowSync({
    stores,
    windowKind: "pet",
    ...conversationSyncStores(conversation),
    log,
  });
  // Mouth preview (separate window → this window VRM): gain slider drag moves actual mouth.
  core.bridge.onMouthPreview((mouthOpen) => {
    if (mouthOpen == null) renderer.stopMouth();
    else renderer.setMouthOpen(mouthOpen);
  });
  // Voice toggle (separate window → this window STT): existing voiceInputStatus subscription starts/stops sttVad.
  core.bridge.onVoiceSet((on) => {
    log.info("voice_toggle_received", { on, source: "settings_window" });
    voiceInputStatus.set(on ? "listening" : "idle");
  });
  // Voice state (this window → separate window): separate window indicator reflects actual STT state.
  voiceInputStatus.subscribe((snapshot) => {
    core.bridge.emitVoiceState({ state: snapshot.state });
  });
  return {
    broadcastSettings: core.broadcastSettings,
    onRemoteChange: core.onRemoteChange,
    bridge: core.bridge,
    dispose: core.dispose,
  };
}

/**
 * Settings-window cross-window sync. Unlike the pet window, the VRM and speaker selections resync
 * here too — this window commits them store-only, so it has to pick up the pet window's picks.
 */
export function wireSettingsWindowSync(deps: {
  stores: SettingsStores;
  conversation: ConversationStores;
  vrmSelection: { reloadFromStorage(): void };
  speakerSelection: { reloadFromStorage(): void };
  log: Logger;
}): {
  bridge: SettingsBridge;
  broadcastSettings: () => void;
  reload: () => void;
  dispose: () => void;
} {
  const { stores, conversation, vrmSelection, speakerSelection, log } = deps;
  const conversationSync = conversationSyncStores(conversation);
  const { bridge, broadcastSettings, reload, dispose } = wireWindowSync({
    stores,
    windowKind: "settings",
    extraReload: [...conversationSync.extraReload, vrmSelection, speakerSelection],
    extraBroadcast: conversationSync.extraBroadcast,
    log,
  });
  return { bridge, broadcastSettings, reload, dispose };
}

/** Devtools-window cross-window sync — the shared core plus the conversation-store extras. */
export function wireDevtoolsSync(deps: {
  stores: SettingsStores;
  conversation: ConversationStores;
  log: Logger;
}): {
  reload: () => void;
  dispose: () => void;
} {
  const { reload, dispose } = wireWindowSync({
    stores: deps.stores,
    windowKind: "devtools",
    ...conversationSyncStores(deps.conversation),
    log: deps.log,
  });
  return { reload, dispose };
}
