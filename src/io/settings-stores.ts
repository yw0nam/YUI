import { createAgentNotifySettings, localStorageAgentNotifyStorage } from "./agent-notify-settings";
import { createAgentSettings, localStorageAgentStorage } from "./agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "./api-key-settings";
import { createCameraSettings, localStorageCameraStorage } from "./camera-settings";
import { createChatHistoryStore, localStorageChatHistoryStorage } from "./chat-history-store";
import { createChatKeySettings, localStorageChatKeyStorage } from "./chat-key-settings";
import { createContextHistory, localStorageContextHistory } from "./context-history";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./endpoints-settings";
import {
  createExpressMotionSettings,
  localStorageExpressMotionStorage,
} from "./express-motion-settings";
import { createFillerSettings, localStorageFillerStorage } from "./filler-settings";
import { createGuardrailsSettings, localStorageGuardrailsStorage } from "./guardrails-settings";
import { createIdleMotionSettings, localStorageIdleMotionStorage } from "./idle-motion-settings";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./lipsync-settings";
import {
  createMessageWindowSettings,
  localStorageMessageWindowStorage,
} from "./message-window-settings";
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
import { createScreenKnobSettings, localStorageScreenKnobStorage } from "./screen-settings";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./screenshot-settings";
import { createSectionsSettings, localStorageSectionsStorage } from "./sections-settings";
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

/** Global proactive gap held after any turn start, in ms. 0 disables the pacer; ceiling is 3 h. */
export const createPacerGapStore = (
  storage: PersistedStorage<{ value: number }> = localStorageStore("yui.proactive-pacer-gap"),
) => createClampedIntSettings({ default: 600000, floor: 0, ceil: 10800000 }, { storage });

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
  // Frontmost-transition (screen-change) proactive turns on/off. Default OFF — it fires from what is on screen.
  const screenSettings = createFlagSettings(false, { storage: localStorageStore("yui.screen") });
  // User-edited screen-watch thresholds: localStorage overrides the bundled config (0 = fallback).
  const screenKnobSettings = createScreenKnobSettings({
    storage: localStorageScreenKnobStorage(),
  });
  // Agent notification on/off + listen port. Gates only source firing.
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  // Presence window threshold — "present when idle ≤ N ms". Shared by proactive/agent sources.
  const presenceSettings = createPresenceStore();
  // Global quiet gap every proactive source waits out after a turn start.
  const pacerGapSettings = createPacerGapStore();
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
  // "Start new conversation" writes a session boundary instead of erasing it (quick-controls). Broadcast so the
  // settings window's History tab updates as turns land in the pet window.
  const chatHistoryStore = createChatHistoryStore({ storage: localStorageChatHistoryStorage() });
  // Speech bubble persistence: when on, speech holds until dismissed instead of fading after dwell. Default OFF.
  const bubblePersistSettings = createFlagSettings(false, {
    storage: localStorageStore("yui.bubble-persist"),
  });
  // Docked/popped message window plus its last outer position. The mode is edited from the
  // settings window too, so it broadcasts; the position is merged over storage on every write.
  const messageWindowSettings = createMessageWindowSettings({
    storage: localStorageMessageWindowStorage(),
  });
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
  // Ambient window climbing on/off. Default ON. Off takes her off the wall and stops scheduling.
  const climbSettings = createFlagSettings(true, { storage: localStorageStore("yui.climb") });
  // First-run onboarding hint — flag shown only once.
  // enabled === onboarding hint already seen.
  const hintSettings = createFlagSettings(false, { storage: localStorageStore("yui.hint") });
  // enabled === rail is collapsed.
  const railCollapsedSettings = createFlagSettings(false, {
    storage: localStorageStore("yui.quickControls.railCollapsed"),
  });
  // Quick Controls collapsible sections: ids the user closed. Absent ⇒ open (today's layout).
  const sectionsSettings = createSectionsSettings({
    storage: localStorageSectionsStorage(),
  });
  // User-edited guardrail rate-limit caps: localStorage overrides the bundled config (0 = fallback).
  const guardrailsSettings = createGuardrailsSettings({
    storage: localStorageGuardrailsStorage(),
  });
  // Per-variant on/off overlay over the read-only ambient idle pool in configs/motions.json.
  const idleMotionSettings = createIdleMotionSettings({
    storage: localStorageIdleMotionStorage(),
  });
  // Per-motion on/off overlay curating the agent-selectable vocabulary published to the broker.
  const expressMotionSettings = createExpressMotionSettings({
    storage: localStorageExpressMotionStorage(),
  });

  return {
    screenshotSettings,
    ttsSettings,
    sttSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    workflowSettings,
    screenSettings,
    screenKnobSettings,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    contextHistory,
    lipsyncSettings,
    vadSettings,
    agentSettings,
    fillerSettings,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    bubblePersistSettings,
    messageWindowSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    cameraSettings,
    gazeSettings,
    climbSettings,
    hintSettings,
    railCollapsedSettings,
    sectionsSettings,
    guardrailsSettings,
    idleMotionSettings,
    expressMotionSettings,
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
  screenSettings: "broadcast",
  screenKnobSettings: "broadcast",
  agentNotifySettings: "broadcast",
  presenceSettings: "broadcast",
  pacerGapSettings: "broadcast",
  contextHistory: "reload",
  lipsyncSettings: "broadcast",
  vadSettings: "broadcast",
  agentSettings: "broadcast",
  fillerSettings: "broadcast",
  sessionStore: "reload",
  sessionDiagnostics: "reload",
  chatHistoryStore: "broadcast",
  bubblePersistSettings: "broadcast",
  messageWindowSettings: "broadcast",
  endpointsSettings: "broadcast",
  chatKeySettings: "broadcast",
  sttKeySettings: "broadcast",
  ttsKeySettings: "broadcast",
  cameraSettings: "broadcast",
  gazeSettings: "broadcast",
  climbSettings: "broadcast",
  hintSettings: "local",
  railCollapsedSettings: "broadcast",
  sectionsSettings: "broadcast",
  guardrailsSettings: "broadcast",
  idleMotionSettings: "broadcast",
  expressMotionSettings: "broadcast",
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
