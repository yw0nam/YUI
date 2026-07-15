/**
 * Settings window (pop-out) bootstrap — settings.html entry point.
 *
 * Mounts the pet window's quick-controls standalone with variant:"window". No renderer/VRM (settings only).
 * Sync with the main window: receive localStorage writes via the `storage` event and reload the store,
 * plus reload once on focus (Tauri may not emit cross-window storage events).
 */

import "./styles.css";
import { createConfigStore } from "./config";
import {
  createAgentNotifySettings,
  localStorageAgentNotifyStorage,
} from "./io/agent-notify-settings";
import { createAgentSettings, localStorageAgentStorage } from "./io/agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "./io/api-key-settings";
import { resolveAssetUrl } from "./io/asset-url";
import { selectFetch } from "./io/chat-client";
import { createChatHistoryStore, localStorageChatHistoryStorage } from "./io/chat-history-store";
import { createChatKeySettings, localStorageChatKeyStorage } from "./io/chat-key-settings";
import { createEndpointsSettings, localStorageEndpointsStorage } from "./io/endpoints-settings";
import { createFillerSettings, localStorageFillerStorage } from "./io/filler-settings";
import {
  createIdleThrottleSettings,
  localStorageIdleThrottleStorage,
} from "./io/idle-throttle-settings";
import { ensureRegistered, updateVoice } from "./io/irodori-voices";
import { createLipsyncSettings, localStorageLipsyncStorage } from "./io/lipsync-settings";
import { createPresenceSettings, localStoragePresenceStorage } from "./io/presence-settings";
import { createProactiveSettings, localStorageProactiveStorage } from "./io/proactive-settings";
import {
  createRailCollapsedSettings,
  localStorageRailCollapsedStorage,
} from "./io/rail-collapsed-settings";
import { createRecentAppsSettings, localStorageRecentAppsStorage } from "./io/recent-apps-settings";
import { createScheduleSettings, localStorageScheduleStorage } from "./io/schedule-settings";
import { createScreenshotSettings, localStorageScreenshotStorage } from "./io/screenshot-settings";
import {
  createSessionDiagnosticsStore,
  localStorageSessionDiagnosticsStorage,
} from "./io/session-diagnostics";
import { createSessionStore, localStorageSessionStorage } from "./io/session-store";
import { createSettingsBridge } from "./io/settings-bridge";
import { closeSettingsWindow, wireStorageSync } from "./io/settings-window";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import { resolveScreenSourceProvider } from "./io/tauri-screen";
import { createTtsSettings, localStorageTtsStorage } from "./io/tts-settings";
import { createVadSettings, localStorageVadStorage } from "./io/vad-settings";
import { importVoiceFromFile, removeUserVoice as removeUserVoiceFile } from "./io/voice-import";
import { importVrmFromFile, removeUserVrm } from "./io/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./io/vrm-selection";
import { createLogger, initLogger } from "./logger";
import {
  reloadFromStorage as reloadLocaleFromStorage,
  subscribe as subscribeLocale,
} from "./ui/i18n";
import { createQuickControls } from "./ui/quick-controls";
import { createVoiceInputStatus } from "./ui/voice-input-status";

const log = createLogger("settings-bootstrap");

async function bootstrap(): Promise<void> {
  await initLogger();
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) {
    throw new Error("#app mount point not found");
  }

  const screenshotSettings = createScreenshotSettings({ storage: localStorageScreenshotStorage() });
  const idleThrottleSettings = createIdleThrottleSettings({
    storage: localStorageIdleThrottleStorage(),
  });
  const proactiveSettings = createProactiveSettings({ storage: localStorageProactiveStorage() });
  const scheduleSettings = createScheduleSettings({ storage: localStorageScheduleStorage() });
  const agentNotifySettings = createAgentNotifySettings({
    storage: localStorageAgentNotifyStorage(),
  });
  const presenceSettings = createPresenceSettings({ storage: localStoragePresenceStorage() });
  const recentAppsSettings = createRecentAppsSettings({
    storage: localStorageRecentAppsStorage(),
  });
  const railCollapsedSettings = createRailCollapsedSettings({
    storage: localStorageRailCollapsedStorage(),
  });
  const lipsyncSettings = createLipsyncSettings({ storage: localStorageLipsyncStorage() });
  const vadSettings = createVadSettings({ storage: localStorageVadStorage() });
  const fillerSettings = createFillerSettings({ storage: localStorageFillerStorage() });
  const ttsSettings = createTtsSettings({ storage: localStorageTtsStorage() });
  const agentSettings = createAgentSettings({ storage: localStorageAgentStorage() });
  const endpointsSettings = createEndpointsSettings({ storage: localStorageEndpointsStorage() });
  // Runtime chat API key store (same localStorage key). This window has no SecretProvider (no dispatcher);
  // it only handles field display + cross-window sync.
  const chatKeySettings = createChatKeySettings({ storage: localStorageChatKeyStorage() });
  const sttKeySettings = createSttKeySettings();
  const ttsKeySettings = createTtsKeySettings();
  const voiceInputStatus = createVoiceInputStatus();
  const sourceProvider = resolveScreenSourceProvider();
  // Session pointer + diagnostics. When the pet window writes to localStorage, this window reloads via the storage event.
  const sessionStore = createSessionStore(localStorageSessionStorage());
  const sessionDiagnostics = createSessionDiagnosticsStore(localStorageSessionDiagnosticsStorage());
  // Unified conversation transcript — when "start new conversation" clears it here, the pet window reloads via the storage event.
  const chatHistoryStore = createChatHistoryStore({ storage: localStorageChatHistoryStorage() });

  // Real-time wiring with main window (Tauri events). This window has no renderer/STT, so send controls
  // to main window, receive voice state from main window and reflect. Storage fallback maintained below.
  const bridge = createSettingsBridge();

  // Config for default instructions placeholder loaded best-effort only (failure → generic placeholder).
  const config = createConfigStore();
  let configLoaded = false;
  try {
    await config.load();
    configLoaded = true;
  } catch (err) {
    log.warn("config_load_failed", { error: String(err) });
  }

  // VRM selection store + swap. This window has no renderer, so store-only commit.
  // Main window hot-swaps actual VRM via storage reload.
  // Create with fallback default, inject actual available[] if config loaded (same as main window).
  const vrmSelection = createVrmSelection({
    defaultUrl: "/vrms/carlotta.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  if (configLoaded) {
    try {
      const avatar = config.get().avatar;
      vrmSelection.setManifest({ available: avatar.available, defaultUrl: avatar.vrm_url });
    } catch (err) {
      log.warn("avatar_config_read_failed", { fallback: true, error: String(err) });
    }
  }
  const swapVrm = async (option: { id: string }): Promise<void> => {
    vrmSelection.select(option.id);
  };
  // BYO-VRM import (settings window) — no renderer, delegate load/metadata to pet window. Copy file,
  // add option with filename stem label, select only. Pet window performs actual load cross-window.
  // Cancel (null) silently ignored.
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile();
    if (option === null) return;
    vrmSelection.addUserOption(option);
    vrmSelection.select(option.id);
  };

  // irodori speaker selection store. This window has no synth, so store-only commit — registration
  // performed by pet window's synth path on next utterance (same as swapVrm being select-only).
  const speakerSelection = createSpeakerSelection({
    defaultId: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  if (configLoaded) {
    try {
      const eps = config.get().endpoints;
      speakerSelection.setManifest({
        available: eps.irodori_voices,
        defaultId: eps.irodori_speaker ?? "",
      });
    } catch (err) {
      log.warn("irodori_config_read_failed", { fallback: true, error: String(err) });
    }
  }
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    speakerSelection.select(option.id);
  };
  // Reference voice re-registration — unlike pet window, no synth, but update is direct server call,
  // so perform here too. Throw if config not loaded/irodori_base_url missing → UI exposes error.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const irodoriBaseUrl = configLoaded ? config.get().endpoints.irodori_base_url : undefined;
    if (!irodoriBaseUrl) throw new Error("irodori provider requires irodori_base_url");
    const f = await selectFetch();
    await updateVoice({ baseUrl: irodoriBaseUrl, id: option.id, refUrl: option.ref_url, fetch: f });
  };
  // BYO-voice import (settings window) — registration is direct server call, perform here too (same as refreshSpeaker).
  // Copy file → irodori register → add option + select. Cancel (null) ignored. Registration failure: remove orphan copy then throw.
  const importVoice = async (): Promise<void> => {
    const option = await importVoiceFromFile();
    if (option === null) return;
    try {
      const irodoriBaseUrl = configLoaded ? config.get().endpoints.irodori_base_url : undefined;
      if (!irodoriBaseUrl) throw new Error("irodori provider requires irodori_base_url");
      const f = await selectFetch();
      await ensureRegistered({
        baseUrl: irodoriBaseUrl,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    } catch (err) {
      await removeUserVoiceFile(option.id).catch(() => {}); // Remove orphan copy (best-effort)
      log.error("imported_voice_register_failed", { error: String(err) });
      throw err;
    }
    speakerSelection.addUserVoice(option);
    speakerSelection.select(option.id);
  };

  const buildQuickControls = (): ReturnType<typeof createQuickControls> =>
    createQuickControls({
      mount: app,
      variant: "window",
      // Close settings window with Escape — closing for window variant is OS window's job.
      onCloseWindow: closeSettingsWindow,
      agentSettings,
      settings: screenshotSettings,
      idleThrottleSettings,
      proactiveSettings,
      scheduleSettings,
      agentNotifySettings,
      presenceSettings,
      recentAppsSettings,
      railCollapsedSettings,
      sourceProvider,
      voiceStatus: voiceInputStatus,
      lipsync: lipsyncSettings,
      vad: vadSettings,
      fillerSettings,
      ttsSettings,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      importVoice,
      removeUserVoice: removeUserVoiceFile,
      resolveAuditionUrl: (refUrl) => resolveAssetUrl(refUrl),
      // Renderer in main window, pass gain preview via bridge → main window VRM mouth moves.
      onGainPreview: (mouthOpen) => bridge.emitMouthPreview(mouthOpen),
      onGainPreviewEnd: () => bridge.emitMouthPreview(null),
      getDefaultInstructions: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().endpoints.chat_instructions;
        } catch {
          return undefined;
        }
      },
      endpointsSettings,
      chatKeySettings,
      sttKeySettings,
      ttsKeySettings,
      getEndpointDefaults: () => {
        if (!configLoaded) return undefined;
        try {
          const e = config.get().endpoints;
          return {
            chat_base_url: e.chat_base_url,
            stt_base_url: e.stt_base_url,
            tts_base_url: e.tts_base_url,
            irodori_base_url: e.irodori_base_url ?? "",
            broker_base_url: e.broker_base_url ?? "",
            chat_model: e.chat_model ?? "",
            chat_api: e.chat_api ?? "",
            tts_voice: e.tts_voice ?? "",
            tts_provider: e.tts_provider ?? "",
          };
        } catch {
          return undefined;
        }
      },
      getDefaultProvider: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().endpoints.tts_provider;
        } catch {
          return undefined;
        }
      },
      getDefaultChatApi: () => {
        if (!configLoaded) return undefined;
        try {
          return config.get().endpoints.chat_api;
        } catch {
          return undefined;
        }
      },
      sessionDiagnostics,
      sessionStore,
      transcript: chatHistoryStore,
    });

  // quick-controls fully re-mounts on display language change (setLocale → i18n.subscribe).
  // Defer to microtask so component doesn't destroy itself during its own click handler.
  let quickControls = buildQuickControls();
  // window variant auto-opens on creation but is idempotent, so defensively call once more.
  quickControls.open();

  const unsubscribeLocale = subscribeLocale(() => {
    queueMicrotask(() => {
      quickControls.dispose();
      quickControls = buildQuickControls();
      quickControls.open();
    });
  });
  window.addEventListener("beforeunload", unsubscribeLocale);

  // Reflect main window edits: cross-window storage event + focus fallback.
  // Also reload vrmSelection so pet window selection changes reflected in this window UI.
  const resyncStores = [
    agentSettings,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    lipsyncSettings,
    vadSettings,
    fillerSettings,
    ttsSettings,
    screenshotSettings,
    idleThrottleSettings,
    proactiveSettings,
    scheduleSettings,
    agentNotifySettings,
    presenceSettings,
    recentAppsSettings,
    vrmSelection,
    speakerSelection,
    sessionStore,
    sessionDiagnostics,
    chatHistoryStore,
    railCollapsedSettings,
  ];
  wireStorageSync(resyncStores);
  window.addEventListener("focus", () => {
    for (const s of resyncStores) s.reloadFromStorage();
    reloadLocaleFromStorage();
  });

  // Voice toggle (this window → main STT) and voice state reflection (main → this window).
  // Component drives local voiceInputStatus, so send changes to main, receive actual STT state and reflect.
  let applyingRemoteVoice = false;
  voiceInputStatus.subscribe((snap) => {
    if (!applyingRemoteVoice) bridge.emitVoiceSet(snap.state !== "idle");
  });
  bridge.onVoiceState((s) => {
    applyingRemoteVoice = true;
    try {
      voiceInputStatus.set(s.state);
    } finally {
      applyingRemoteVoice = false;
    }
  });

  // Settings sync (bidirectional, loop-guarded): this window edit → emit; main notification → reload stores.
  // Debounce: consolidate slider drag/typing bursts into single cross-window event after 200ms idle.
  let applyingRemote = false;
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcastSettings = (): void => {
    if (applyingRemote) return;
    if (broadcastTimer) clearTimeout(broadcastTimer);
    broadcastTimer = setTimeout(() => {
      broadcastTimer = null;
      bridge.emitSettingsChanged();
    }, 200);
  };
  agentSettings.subscribe(broadcastSettings);
  endpointsSettings.subscribe(broadcastSettings);
  chatKeySettings.subscribe(broadcastSettings);
  sttKeySettings.subscribe(broadcastSettings);
  ttsKeySettings.subscribe(broadcastSettings);
  lipsyncSettings.subscribe(broadcastSettings);
  vadSettings.subscribe(broadcastSettings);
  fillerSettings.subscribe(broadcastSettings);
  ttsSettings.subscribe(broadcastSettings);
  screenshotSettings.subscribe(broadcastSettings);
  idleThrottleSettings.subscribe(broadcastSettings);
  proactiveSettings.subscribe(broadcastSettings);
  scheduleSettings.subscribe(broadcastSettings);
  agentNotifySettings.subscribe(broadcastSettings);
  presenceSettings.subscribe(broadcastSettings);
  recentAppsSettings.subscribe(broadcastSettings);
  // Display language change also signaled cross-window → pet window receives and redraws UI in new language.
  subscribeLocale(broadcastSettings);
  // VRM selection also signaled cross-window → pet window receives and hot-swaps renderer (backup for Tauri storage event instability).
  vrmSelection.subscribe(broadcastSettings);
  // Speaker selection also signaled cross-window → pet window receives and synthesizes with new speaker on next utterance.
  speakerSelection.subscribe(broadcastSettings);
  bridge.onSettingsChanged(() => {
    applyingRemote = true;
    try {
      for (const s of resyncStores) s.reloadFromStorage();
      reloadLocaleFromStorage();
    } finally {
      applyingRemote = false;
    }
  });
}

void bootstrap();
