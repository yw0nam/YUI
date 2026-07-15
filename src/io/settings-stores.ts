import { createAgentNotifySettings, localStorageAgentNotifyStorage } from "./agent-notify-settings";
import { createAgentSettings, localStorageAgentStorage } from "./agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "./api-key-settings";
import { createCameraSettings, localStorageCameraStorage } from "./camera-settings";
import { createChatHistoryStore, localStorageChatHistoryStorage } from "./chat-history-store";
import { createChatKeySettings, localStorageChatKeyStorage } from "./chat-key-settings";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./endpoints-settings";
import { createFillerSettings, localStorageFillerStorage } from "./filler-settings";
import { createGazeSettings, localStorageGazeStorage } from "./gaze-settings";
import { createHintSettings, localStorageHintStorage } from "./hint-settings";
import {
  createIdleThrottleSettings,
  localStorageIdleThrottleStorage,
} from "./idle-throttle-settings";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./lipsync-settings";
import { createPresenceSettings, localStoragePresenceStorage } from "./presence-settings";
import { createProactiveSettings, localStorageProactiveStorage } from "./proactive-settings";
import {
  createRailCollapsedSettings,
  localStorageRailCollapsedStorage,
} from "./rail-collapsed-settings";
import { createRecentAppsSettings, localStorageRecentAppsStorage } from "./recent-apps-settings";
import { createScheduleSettings, localStorageScheduleStorage } from "./schedule-settings";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./screenshot-settings";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "./session-store";
import { createSttSettings, localStorageSttStorage } from "./stt-settings";
import { createTtsSettings, localStorageTtsStorage } from "./tts-settings";
import { createVadSettings, localStorageVadStorage } from "./vad-settings";

// localStorage-backed settings/state stores. Pure instantiation — no wiring, no renderer,
// no dispatcher. bootstrap() destructures the bag and owns the wiring (renderer, storage-sync).
export function createSettingsStores() {
  const screenshotSettings = createScreenshotSettings({
    storage: localStorageScreenshotStorage(),
  });
  // TTS voice output on/off. Default ON. When OFF, skip synth and show only expression/motion + speech bubble.
  const ttsSettings = createTtsSettings({
    storage: localStorageTtsStorage(),
  });
  // STT voice-input on/off intent. Default OFF. If quit while on, auto-resumes on the next run.
  const sttSettings = createSttSettings({
    storage: localStorageSttStorage(),
  });
  // Idle power-saving (30fps cap) on/off. Default ON.
  const idleThrottleSettings = createIdleThrottleSettings({
    storage: localStorageIdleThrottleStorage(),
  });
  // Proactive-reaction (no interaction for N min → proactive.<id>) settings. Gates only source firing — subscriptions aren't stopped.
  const proactiveSettings = createProactiveSettings({
    storage: localStorageProactiveStorage(),
  });
  // Time-of-day greeting (HH:MM → schedule.<id>) settings.
  const scheduleSettings = createScheduleSettings({
    storage: localStorageScheduleStorage(),
  });
  // Agent-completion notification on/off + listen port. Gates only source firing.
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  // Presence window threshold — "present when idle ≤ N ms". Shared by proactive/agent sources.
  const presenceSettings = createPresenceSettings({ storage: localStoragePresenceStorage() });
  // Recent-apps buffer cap — os-context caps its app-switch buffer at this value.
  const recentAppsSettings = createRecentAppsSettings({
    storage: localStorageRecentAppsStorage(),
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
  // Camera gaze-tracking on/off. Default ON. Streams every change (toggle/cross-window) to the renderer.
  const gazeSettings = createGazeSettings({ storage: localStorageGazeStorage() });
  // First-run onboarding hint — flag shown only once.
  const hintSettings = createHintSettings({ storage: localStorageHintStorage() });
  const railCollapsedSettings = createRailCollapsedSettings({
    storage: localStorageRailCollapsedStorage(),
  });

  return {
    screenshotSettings,
    ttsSettings,
    sttSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
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
