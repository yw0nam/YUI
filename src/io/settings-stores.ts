import { createAgentNotifySettings, localStorageAgentNotifyStorage } from "./agent-notify-settings";
import { createAgentSettings, localStorageAgentStorage } from "./agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "./api-key-settings";
import { createCameraSettings, localStorageCameraStorage } from "./camera-settings";
import { createChatHistoryStore, localStorageChatHistoryStorage } from "./chat-history-store";
import { createChatKeySettings, localStorageChatKeyStorage } from "./chat-key-settings";
import { createContextHistory, localStorageContextHistory } from "./context-history";
import { createContextSettings, localStorageContextSettings } from "./context-settings";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./endpoints-settings";
import { createFillerSettings, localStorageFillerStorage } from "./filler-settings";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./lipsync-settings";
import {
  createClampedIntSettings,
  createFlagSettings,
  localStorageStore,
  type PersistedStorage,
} from "./persisted-store";
import {
  type CueLocale,
  createProactiveSettings,
  localStorageProactiveStorage,
} from "./proactive-settings";
import { createScheduleSettings, localStorageScheduleStorage } from "./schedule-settings";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./screenshot-settings";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "./session-store";
import { createVadSettings, localStorageVadStorage } from "./vad-settings";
import { createWorkflowSettings, localStorageWorkflowStorage } from "./workflow-settings";

export const createPresenceStore = (
  storage: PersistedStorage<{ value: number }> = localStorageStore("yui.presence"),
) =>
  createClampedIntSettings(
    { default: 180000, floor: 10000, ceil: Number.MAX_SAFE_INTEGER },
    { storage },
  );

export const createRecentAppsStore = (
  storage: PersistedStorage<{ value: number }> = localStorageStore("yui.recent-apps"),
) => createClampedIntSettings({ default: 10, floor: 1, ceil: 50 }, { storage });

// localStorage-backed settings/state stores. Pure instantiation — no wiring, no renderer,
// no dispatcher. bootstrap() destructures the bag and owns the wiring (renderer, storage-sync).
export function createSettingsStores(opts?: { locale?: CueLocale }) {
  const screenshotSettings = createScreenshotSettings({
    storage: localStorageScreenshotStorage(),
  });
  // TTS voice output on/off. Default ON. When OFF, skip synth and show only expression/motion + speech bubble.
  const ttsSettings = createFlagSettings(true, { storage: localStorageStore("yui.tts") });
  // STT voice-input on/off intent. Default OFF. If quit while on, auto-resumes on the next run.
  const sttSettings = createFlagSettings(false, { storage: localStorageStore("yui.stt") });
  // Idle power-saving (30fps cap) on/off. Default ON.
  const idleThrottleSettings = createFlagSettings(true, {
    storage: localStorageStore("yui.idle-throttle"),
  });
  // Proactive-reaction (no interaction for N min → proactive.<id>) settings. Gates only source firing — subscriptions aren't stopped.
  const proactiveSettings = createProactiveSettings({
    storage: localStorageProactiveStorage(),
    locale: opts?.locale,
  });
  // Time-of-day greeting (HH:MM → schedule.<id>) settings.
  const scheduleSettings = createScheduleSettings({
    storage: localStorageScheduleStorage(),
    locale: opts?.locale,
  });
  const workflowSettings = createWorkflowSettings({
    storage: localStorageWorkflowStorage(),
  });
  // Agent-completion notification on/off + listen port. Gates only source firing.
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  // Presence window threshold — "present when idle ≤ N ms". Shared by proactive/agent sources.
  const presenceSettings = createPresenceStore();
  // Recent-apps buffer cap — os-context caps its app-switch buffer at this value.
  const recentAppsSettings = createRecentAppsStore();
  const contextSettings = createContextSettings({
    storage: localStorageContextSettings(),
  });
  const contextHistory = createContextHistory({
    storage: localStorageContextHistory(),
  });
  const lipsyncSettings = createLipsyncSettings({
    storage: localStorageLipsyncStorage(),
  });
  const vadSettings = createVadSettings({ storage: localStorageVadStorage() });
  const agentSettings = createAgentSettings({
    storage: localStorageAgentStorage(),
  });
  // TTFT filler (thinking motion + filler utterance) settings. Both windows sync via wireStorageSync.
  const fillerSettings = createFillerSettings({
    storage: localStorageFillerStorage(),
  });
  // Session-continuity store: rotating id pointer + diagnostics (used/window/last-compression). Both windows
  // sync via wireStorageSync, so build it early alongside the other stores (no config/dispatcher dependency).
  const sessionStore = createSessionStore(localStorageSessionStorage());
  const sessionDiagnostics = createSessionDiagnosticsStore(localStorageSessionDiagnosticsStorage());
  // Unified conversation transcript — both protocol modes append, and only CC mode pulls its outbound share from here.
  // "Start new conversation" clears it along with the session stores (quick-controls). Both windows sync via wireStorageSync.
  const chatHistoryStore = createChatHistoryStore({ storage: localStorageChatHistoryStorage() });
  // User-edited endpoint overrides: localStorage overrides the bundled config (empty value = fallback).
  const endpointsSettings = createEndpointsSettings({
    storage: localStorageEndpointsStorage(),
  });
  // Runtime chat API key override: localStorage overrides the build-time key (empty value = fallback). Value is secret.
  const chatKeySettings = createChatKeySettings({
    storage: localStorageChatKeyStorage(),
  });
  // Runtime STT/openai-TTS key overrides (localStorage). Empty value = .env.local fallback. Values are secret.
  const sttKeySettings = createSttKeySettings();
  const ttsKeySettings = createTtsKeySettings();
  // Camera zoom: applies the persisted scale at boot and streams every change (wheel/cross-window) to the renderer.
  const cameraSettings = createCameraSettings({
    storage: localStorageCameraStorage(),
  });
  // Cursor gaze-tracking on/off. Default ON. Streams every change (toggle/cross-window) to the renderer.
  const gazeSettings = createFlagSettings(true, { storage: localStorageStore("yui.gaze") });
  // First-run onboarding hint — flag shown only once.
  // enabled === onboarding hint already seen.
  const hintSettings = createFlagSettings(false, { storage: localStorageStore("yui.hint") });
  // enabled === rail is collapsed.
  const railCollapsedSettings = createFlagSettings(false, {
    storage: localStorageStore("yui.quickControls.railCollapsed"),
  });

  return {
    screenshotSettings,
    ttsSettings,
    sttSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    workflowSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
    contextSettings,
    contextHistory,
    lipsyncSettings,
    vadSettings,
    agentSettings,
    fillerSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    hintSettings,
    railCollapsedSettings,
  };
}

export type SettingsStores = ReturnType<typeof createSettingsStores>;

/** A settings store that participates in cross-window broadcast and reload. */
export type SyncedStore = {
  subscribe(cb: () => void): () => void;
  reloadFromStorage(): void;
};

/** Cross-window sync participation. "broadcast" implies everything "reload" does. */
type SyncMode = "local" | "reload" | "broadcast";

/** Exported so a test can assert totality against the store bag's actual keys. */
export const SYNC_MODE: Record<keyof SettingsStores, SyncMode> = {
  screenshotSettings: "broadcast",
  ttsSettings: "broadcast",
  sttSettings: "local",
  idleThrottleSettings: "broadcast",
  proactiveSettings: "broadcast",
  scheduleSettings: "broadcast",
  workflowSettings: "broadcast",
  agentNotifySettings: "broadcast",
  presenceSettings: "broadcast",
  recentAppsSettings: "broadcast",
  contextSettings: "broadcast",
  contextHistory: "reload",
  lipsyncSettings: "broadcast",
  vadSettings: "broadcast",
  agentSettings: "broadcast",
  fillerSettings: "broadcast",
  sessionStore: "reload",
  sessionDiagnostics: "reload",
  chatHistoryStore: "reload",
  endpointsSettings: "broadcast",
  chatKeySettings: "broadcast",
  sttKeySettings: "broadcast",
  ttsKeySettings: "broadcast",
  cameraSettings: "broadcast",
  gazeSettings: "broadcast",
  hintSettings: "local",
  railCollapsedSettings: "broadcast",
};

/** Stores that reload on a remote signal — the `storage` event and a bridge settings-changed alike. */
export function reloadSyncStores(
  stores: SettingsStores,
): ReadonlyArray<{ reloadFromStorage(): void }> {
  return (Object.keys(stores) as Array<keyof SettingsStores>)
    .filter((key) => SYNC_MODE[key] !== "local")
    .map((key) => stores[key]);
}

/** Stores whose local edits emit a cross-window settings-changed event. */
export function broadcastSyncStores(stores: SettingsStores): SyncedStore[] {
  return (Object.keys(stores) as Array<keyof SettingsStores>)
    .filter((key) => SYNC_MODE[key] === "broadcast")
    .map((key) => stores[key]);
}
