/**
 * Quick-controls panel — settings panel summoned by right-click.
 * Comprises draggable header + tab strip (chat · character · input · advanced) + tab panel body.
 * variant: "popover" (default, docked in pet window + draggable) | "window" (separate OS window, full fill).
 */

import "./quick-controls.css";
import type { AvatarOption } from "../config/load";
import type { createAgentNotifySettings } from "../io/agent-notify-settings";
import { type createAgentSettings, REASONING_EFFORTS } from "../io/agent-settings";
import type { ApiKeySettingsStore } from "../io/api-key-settings";
import type { createChatHistoryStore } from "../io/chat-history-store";
import type { ChatKeySettingsStore } from "../io/chat-key-settings";
import type { createEndpointsSettings, EndpointOverrides } from "../io/endpoints-settings";
import type { createFillerSettings } from "../io/filler-settings";
import type { createGazeSettings } from "../io/gaze-settings";
import type { createIdleThrottleSettings } from "../io/idle-throttle-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../io/lipsync-settings";
import type { createPresenceSettings } from "../io/presence-settings";
import type { createProactiveSettings } from "../io/proactive-settings";
import type { RailCollapsedSettingsStore } from "../io/rail-collapsed-settings";
import type { createRecentAppsSettings } from "../io/recent-apps-settings";
import type { createScheduleSettings } from "../io/schedule-settings";
import type { ScreenSourceProvider } from "../io/screen-source-provider";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import type { createSessionDiagnosticsStore } from "../io/session-diagnostics";
import type { createSessionStore } from "../io/session-store";
import type { createSpeakerSelection, SpeakerOption } from "../io/speaker-selection";
import type { createTtsSettings } from "../io/tts-settings";
import { type createVadSettings, VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../io/vad-settings";
import type { createVrmSelection } from "../io/vrm-selection";
import type { createWorkflowSettings } from "../io/workflow-settings";
import { createLogger } from "../logger";
import { type CueListInstance, createCueList } from "./cue-list";
import { type Locale, setLocale, t } from "./i18n";
import { createEndpointsSection } from "./quick-controls/endpoints-section";
import { createMonitorsSection } from "./quick-controls/monitors-section";
import { createPopover } from "./quick-controls/popover";
import { createReflect } from "./quick-controls/reflect";
import { createSpeakerList } from "./quick-controls/speaker-list";
import { buildPanelHtml } from "./quick-controls/template";
import { createVrmList } from "./quick-controls/vrm-list";
import { createWorkflowsSection } from "./quick-controls/workflows-section";
import type { VoiceInputStatus } from "./voice-input-status";

// formatTokenCount lives in reflect layer — re-exported for public API compatibility.
export { formatTokenCount } from "./quick-controls/reflect";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type IdleThrottleSettingsStore = ReturnType<typeof createIdleThrottleSettings>;
type GazeSettingsStore = ReturnType<typeof createGazeSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type ScheduleSettingsStore = ReturnType<typeof createScheduleSettings>;
type WorkflowSettingsStore = ReturnType<typeof createWorkflowSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type VadSettingsStore = ReturnType<typeof createVadSettings>;
type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type FillerSettingsStore = ReturnType<typeof createFillerSettings>;
type TtsSettingsStore = ReturnType<typeof createTtsSettings>;
type VrmSelectionStore = ReturnType<typeof createVrmSelection>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;
type SessionDiagnosticsStore = ReturnType<typeof createSessionDiagnosticsStore>;
type SessionStore = ReturnType<typeof createSessionStore>;
type PresenceSettingsStore = ReturnType<typeof createPresenceSettings>;
type RecentAppsSettingsStore = ReturnType<typeof createRecentAppsSettings>;
type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;

interface QuickControlsOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  /** Idle power-save (30fps cap) on/off store. When off, always full frame. */
  idleThrottleSettings: IdleThrottleSettingsStore;
  /** Proactive speech on/off + cue list store. */
  proactiveSettings: ProactiveSettingsStore;
  /** Time-based schedule cue on/off + cue list store. */
  scheduleSettings: ScheduleSettingsStore;
  /** Saved webhook workflows fired from the Reactions tab. */
  workflowSettings: WorkflowSettingsStore;
  sourceProvider: ScreenSourceProvider;
  voiceStatus: VoiceInputStatus;
  lipsync: LipsyncSettingsStore;
  /** STT silence threshold (ms) single-value store. Input tab slider drives it. */
  vad: VadSettingsStore;
  agentSettings: AgentSettingsStore;
  vrmSelection: VrmSelectionStore;
  /** Perform actual swap + commit store on success. Component doesn't call store.select directly. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** Full import flow: file select → load → addUserOption + select. Inline error on reject. */
  importVrm: () => Promise<void>;
  /** Delete imported VRM's app-data file (idempotent). Called separately from store removal. */
  removeUserVrm: (id: string) => Promise<void>;
  speakerSelection: SpeakerSelectionStore;
  /** Perform actual speaker swap + commit store on success. Component doesn't call store.select directly. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Re-register speaker's reference voice (PUT /voices). Server-side update only — doesn't change speaker selection/store. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Full import flow: file select → register → addUserVoice + select. Inline error on reject. */
  importVoice: () => Promise<void>;
  /** Delete imported voice's app-data file (idempotent). Called separately from store removal. */
  removeUserVoice: (id: string) => Promise<void>;
  /** Convert audition ref_url to fetchable URL (injectable). Default is resolveAssetUrl. */
  resolveAuditionUrl?: (refUrl: string) => Promise<string>;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  /** Reset the camera viewpoint (orbit angles) to head-on. Renders the section when set. */
  onResetViewpoint?: () => void;
  onPopOut?: () => void;
  variant?: "popover" | "window";
  /** In window variant, path for Escape to close OS window (host injected). Without it, Escape is no-op. */
  onCloseWindow?: () => void;
  /** Default instructions to show as placeholder when instructions are empty (config.chat_instructions). */
  getDefaultInstructions?: () => string | undefined;
  /** User-edited endpoint overrides store. Empty value = fallback. */
  endpointsSettings: EndpointsSettingsStore;
  /** chat API key overrides store. Empty value = use build-time key. Value is secret — no logging. */
  chatKeySettings: ChatKeySettingsStore;
  /** STT API key overrides store. Same pattern as chat key. Value is secret — no logging. */
  sttKeySettings: ApiKeySettingsStore;
  /** TTS (openai-compatible) API key overrides store. Value is secret — no logging. */
  ttsKeySettings: ApiKeySettingsStore;
  /** Default bundled-config endpoints to show as placeholder (undefined if not loaded). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** Default bundled-config provider for voice engine segment when no override (undefined if not loaded). */
  getDefaultProvider?: () => "openai" | "irodori" | undefined;
  /** Default bundled-config value for Chat API dropdown when no override (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  /** Session diagnostics (context usage · last compression). Session section only renders in window variant. */
  sessionDiagnostics?: SessionDiagnosticsStore;
  /** Current session id pointer. "Start fresh" clears it along with diagnostics. */
  sessionStore?: SessionStore;
  /** Unified conversation transcript. "Start fresh" clears it with session stores (no-op if absent). */
  transcript?: Pick<ChatHistoryStore, "clear">;
  /** Thinking filler settings store. If absent, section won't render (injected by unified agent). */
  fillerSettings?: FillerSettingsStore;
  /** TTS speech output on/off store. */
  ttsSettings?: TtsSettingsStore;
  /** Camera gaze (eye contact) on/off store. If absent, that toggle row won't render. */
  gazeSettings?: GazeSettingsStore;
  /** Agent completion notification on/off store. If absent, that toggle row won't render. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** Away detection store. If absent, presence row in Reactions tab won't render. */
  presenceSettings?: PresenceSettingsStore;
  /** Recent apps memory count cap store. If absent, recent-apps row in Reactions tab won't render. */
  recentAppsSettings?: RecentAppsSettingsStore;
  /** Section rail collapse state store. */
  railCollapsedSettings?: RailCollapsedSettingsStore;
}

interface QuickControls {
  el: HTMLElement;
  open(anchor?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

export function createQuickControls({
  mount,
  settings,
  idleThrottleSettings,
  proactiveSettings,
  scheduleSettings,
  workflowSettings,
  sourceProvider,
  voiceStatus,
  lipsync,
  vad,
  agentSettings,
  vrmSelection,
  swapVrm,
  importVrm,
  removeUserVrm,
  speakerSelection,
  swapSpeaker,
  refreshSpeaker,
  importVoice,
  removeUserVoice,
  resolveAuditionUrl,
  onGainPreview,
  onGainPreviewEnd,
  onResetViewpoint,
  onPopOut,
  variant = "popover",
  onCloseWindow,
  getDefaultInstructions,
  endpointsSettings,
  chatKeySettings,
  sttKeySettings,
  ttsKeySettings,
  getEndpointDefaults,
  getDefaultProvider,
  getDefaultChatApi,
  sessionDiagnostics,
  sessionStore,
  transcript,
  fillerSettings,
  ttsSettings,
  gazeSettings,
  agentNotifySettings,
  presenceSettings,
  recentAppsSettings,
  railCollapsedSettings,
}: QuickControlsOptions): QuickControls {
  const isWindow = variant === "window";
  // Session section renders only in settings window (window), when both stores are injected.
  const hasSession = isWindow && !!sessionDiagnostics && !!sessionStore;
  // Use variant tag to distinguish which window created logs (Tauri merges both window logs to one file).
  const log = createLogger(isWindow ? "settings-ui" : "quick-ui");

  // scrim (outer click detection) only used in popover variant.
  const scrimEl = document.createElement("div");
  scrimEl.className = "yui-quick-scrim";

  const el = document.createElement("div");
  el.className = isWindow ? "yui-quick yui-quick--window" : "yui-quick";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", t("panel.dialog_label"));

  el.innerHTML = buildPanelHtml({
    isWindow,
    hasSession,
    showFiller: !!fillerSettings,
    showViewpoint: !!onResetViewpoint,
    showGaze: !!gazeSettings,
    gazeEnabled: gazeSettings?.get().enabled ?? false,
    showAgentNotify: !!agentNotifySettings,
    agentNotifyEnabled: agentNotifySettings?.get().enabled ?? false,
    ttsEnabled: ttsSettings?.get().enabled ?? true,
    bargeInEnabled: vad.get().bargeIn,
    showPresence: !!presenceSettings,
    showRecentApps: !!recentAppsSettings,
    railCollapsed: railCollapsedSettings?.get() ?? false,
  });

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const idleThrottleSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
  const gazeSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-gaze-switch");
  const agentNotifySwitchBtn = el.querySelector<HTMLButtonElement>(".yui-agentnotify-switch");
  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
  const agentPortInput = el.querySelector<HTMLInputElement>("#yui-agent-port");
  const presenceInput = el.querySelector<HTMLInputElement>("#yui-presence");
  const recentAppsInput = el.querySelector<HTMLInputElement>("#yui-recent-apps");
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const ttsSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-tts-switch");
  const bargeInSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-bargein-switch");
  const monitorsSection = createMonitorsSection({ root: el, sourceProvider, settings, log });
  const vrmsEl = el.querySelector<HTMLDivElement>(".yui-vrms")!;
  const vrmAddBtn = el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
  const spksEl = el.querySelector<HTMLDivElement>(".yui-spks")!;
  const gainSlider = el.querySelector<HTMLInputElement>(".yui-gain__slider:not(.yui-vad__slider)")!;
  const vadSlider = el.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const tablistEl = el.querySelector<HTMLDivElement>(".yui-tabs")!;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab"));
  const railColsEl = el.querySelector<HTMLDivElement>(".yui-quick__cols")!;
  const railCollapseBtn = el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
  const barEl = el.querySelector<HTMLDivElement>(".yui-quick__bar");
  const popOutBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");
  const segEl = el.querySelector<HTMLDivElement>(".yui-field-row .yui-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const spkAddBtn = el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;
  // Viewpoint reset button — exists only when onResetViewpoint is injected (null otherwise).
  const viewpointResetBtn = el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset");
  // Thinking filler section node — exists only when fillerSettings is injected (null otherwise).
  const fillerSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-filler-switch");
  const fillerLangSegEl = el.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const fillerFirstTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-first-textarea");
  const fillerRepeatTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-repeat-textarea",
  );
  const fillerLangBtns = fillerLangSegEl
    ? Array.from(fillerLangSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];
  // Language picker segment (3 buttons) node.
  const langSegEl = el.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));

  // ── Endpoints section (URL fields · API key rows · TTS/Chat dropdowns · per-service resets) ──
  const endpoints = createEndpointsSection({
    root: el,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    getEndpointDefaults,
    reflectEndpoints: () => reflect.reflectEndpoints(),
    isOpen: () => popover.isOpen(),
    log,
  });
  const workflows = createWorkflowsSection({ root: el, store: workflowSettings, log });

  // Session section node (window only — null otherwise).
  const sessionResetBtn = el.querySelector<HTMLButtonElement>(".yui-session__reset");
  // Cue rows also use .yui-confirm pattern, so scope session's specifically.
  const sessionConfirmEl = el.querySelector<HTMLDivElement>(".yui-session .yui-confirm");
  const sessionConfirmBtn = el.querySelector<HTMLButtonElement>(".yui-session__confirm");
  const sessionCancelBtn = el.querySelector<HTMLButtonElement>(".yui-session__cancel");

  gainSlider.min = String(LIPSYNC_GAIN_MIN);
  gainSlider.max = String(LIPSYNC_GAIN_MAX);
  gainSlider.step = "0.1";

  vadSlider.min = String(VAD_SILENCE_MIN);
  vadSlider.max = String(VAD_SILENCE_MAX);
  vadSlider.step = "50";

  // Default instructions placeholder.
  const defaultInstr = getDefaultInstructions?.();
  instructionsEl.placeholder =
    defaultInstr && defaultInstr.length > 0 ? defaultInstr : t("instructions.placeholder_default");

  let gainPreviewing = false;
  // After dispose, prevent in-flight refresh from repainting/timering on destroyed DOM.
  let disposed = false;
  // Speaker-active baseline — re-synced on open (so closed provider changes don't stay stale).
  let lastSpkEnabled = false;

  // ── reflect (store→DOM sync) layer ──
  const reflect = createReflect({
    root: el,
    settings,
    idleThrottleSettings,
    ttsSettings,
    gazeSettings,
    agentNotifySettings,
    lipsync,
    vad,
    agentSettings,
    fillerSettings,
    endpointsSettings,
    sessionDiagnostics,
    keyRows: endpoints.keyRows,
    getEndpointDefaults,
    getDefaultProvider,
    getDefaultChatApi,
    agentPortInput: agentPortInput ?? undefined,
    presenceInput: presenceInput ?? undefined,
    presenceSettings,
    recentAppsInput: recentAppsInput ?? undefined,
    recentAppsSettings,
  });

  // ── VRM section ──

  const vrmList = createVrmList({ root: el, vrmSelection, swapVrm, importVrm, removeUserVrm, log });

  // ── Speaker section ──
  const speakerList = createSpeakerList({
    root: el,
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    importVoice,
    removeUserVoice,
    resolveAuditionUrl,
    log,
    speakerControlsEnabled,
    isDisposed: () => disposed,
  });

  // ── popover shell (position/drag/open-close lifecycle) ──
  const popover = createPopover({
    mount,
    root: el,
    scrim: scrimEl,
    bar: barEl,
    isWindow,
    closeWindow: onCloseWindow,
    onOpen: () => {
      reflect.reflectSettings();
      reflect.reflectIdleThrottle();
      reflect.reflectTts();
      reflect.reflectGaze();
      reflect.reflectAgentNotify();
      reflect.reflectPresence();
      reflect.reflectRecentApps();
      reflect.reflectVoiceStatus(voiceStatus.get());
      reflect.reflectGain();
      reflect.reflectVad();
      reflect.reflectAgent();
      reflect.reflectFiller();
      reflect.reflectLanguage();
      reflect.reflectEndpoints();
      reflect.reflectKeyRows();
      reflect.reflectVoiceEngine();
      reflect.reflectChatType();
      reflect.reflectSession();
      vrmList.render();
      // Provider may have changed while closed; re-sync baseline on open.
      lastSpkEnabled = speakerControlsEnabled();
      speakerList.render();
      if (settings.get().enabled && !monitorsSection.isLoaded()) {
        void monitorsSection.load();
      }
    },
    onClose: () => {
      if (gainPreviewing) {
        onGainPreviewEnd();
        gainPreviewing = false;
      }
      speakerList.stopAudition();
      endpoints.commitDirtyKeys();
    },
  });

  // ── Event handlers ──

  function handleSwitchClick(): void {
    const current = settings.get().enabled;
    settings.setEnabled(!current);
    log.info("screenshot_attach_toggle", { enabled: !current });
    if (!current && !monitorsSection.isLoaded()) {
      void monitorsSection.load();
    }
  }

  function handleIdleThrottleSwitchClick(): void {
    const current = idleThrottleSettings.get().enabled;
    idleThrottleSettings.setEnabled(!current);
    log.info("idle_throttle_toggle", { enabled: !current });
  }

  function handleTtsSwitchClick(): void {
    if (!ttsSettings) return;
    const current = ttsSettings.get().enabled;
    ttsSettings.setEnabled(!current);
    log.info("tts_output_toggle", { enabled: !current });
  }

  function handleBargeInSwitchClick(): void {
    const current = vad.get().bargeIn;
    vad.setBargeIn(!current);
    log.info("bargein_toggle", { enabled: !current });
  }

  function handleGazeSwitchClick(): void {
    if (!gazeSettings) return;
    const current = gazeSettings.get().enabled;
    gazeSettings.setEnabled(!current);
    log.info("gaze_toggle", { enabled: !current });
  }

  function handleAgentNotifySwitchClick(): void {
    if (!agentNotifySettings) return;
    const current = agentNotifySettings.get().enabled;
    agentNotifySettings.setEnabled(!current);
    log.info("agent_notify_toggle", { enabled: !current });
  }

  // ── Thinking filler event handlers ──

  function handleFillerSwitchClick(): void {
    if (!fillerSettings) return;
    fillerSettings.setEnabled(!fillerSettings.get().enabled);
  }

  // Parse textarea rows line-by-line (trim + remove empty lines).
  function parseFillerLines(el: HTMLTextAreaElement | null): string[] {
    if (!el) return [];
    return el.value
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  const FILLER_LANGS = ["ja", "en", "ko"] as const;

  // Move segment selection + focus. aria/tabindex updated by store subscription (reflectFiller).
  function selectFillerLang(index: number, focus = false): void {
    if (!fillerSettings) return;
    const clamped = Math.min(FILLER_LANGS.length - 1, Math.max(0, index));
    const lang = FILLER_LANGS[clamped];
    fillerSettings.setLanguage(lang);
    // When language changes, immediately update both textareas to new language's pool (before store subscription).
    const pool = fillerSettings.get().customPools[lang];
    if (fillerFirstTextareaEl) fillerFirstTextareaEl.value = pool ? pool.first.join("\n") : "";
    if (fillerRepeatTextareaEl) fillerRepeatTextareaEl.value = pool ? pool.repeat.join("\n") : "";
    if (focus) fillerLangBtns[clamped]?.focus();
  }

  function handleFillerLangClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    const idx = fillerLangBtns.indexOf(btn);
    if (idx < 0) return;
    selectFillerLang(idx);
  }

  // Roving-focus keyboard like reasoning-effort segment. Arrows select+focus, Space/Enter selects target.
  function handleFillerLangKeydown(e: KeyboardEvent): void {
    const current = fillerLangBtns.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const base = current < 0 ? 0 : current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectFillerLang(base + 1, true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectFillerLang(base - 1, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectFillerLang(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectFillerLang(FILLER_LANGS.length - 1, true);
    } else if (e.key === " " || e.key === "Enter") {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
      const idx = btn ? fillerLangBtns.indexOf(btn) : -1;
      if (idx < 0) return;
      e.preventDefault();
      selectFillerLang(idx, true);
    }
  }

  // Language picker — WAI-ARIA "selection doesn't follow focus" radio pattern.
  // setLocale changes entire UI language and triggers host remount (expensive/destructive),
  // so arrows only move focus; Space/Enter/click commits.

  // Arrows/Home/End — roving tabindex + move focus only (no commit/aria-checked change).
  function moveLocaleFocus(index: number): void {
    const clamped = Math.min(langSegButtons.length - 1, Math.max(0, index));
    const btn = langSegButtons[clamped];
    if (!btn) return;
    for (const b of langSegButtons) b.tabIndex = -1;
    btn.tabIndex = 0;
    btn.focus();
  }

  // Commit (click/Space/Enter) — only path that actually changes display language.
  function commitLocale(index: number): void {
    const clamped = Math.min(langSegButtons.length - 1, Math.max(0, index));
    const locale = langSegButtons[clamped]?.dataset.locale as Locale | undefined;
    if (!locale) return;
    log.info("ui_language_change", { locale });
    setLocale(locale);
    // locale seg has no store subscription — directly reflect aria/tabindex until remount.
    reflect.reflectLanguage();
    langSegButtons[clamped]?.focus();
  }

  function handleLangSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    const idx = langSegButtons.indexOf(btn);
    if (idx < 0) return;
    commitLocale(idx);
  }

  function handleLangSegKeydown(e: KeyboardEvent): void {
    // Arrow baseline: currently focused radio (else checked one, else 0).
    const focusIdx = langSegButtons.findIndex((b) => b === document.activeElement);
    const checkedIdx = langSegButtons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const base = focusIdx >= 0 ? focusIdx : checkedIdx < 0 ? 0 : checkedIdx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveLocaleFocus(base + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveLocaleFocus(base - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      moveLocaleFocus(0);
    } else if (e.key === "End") {
      e.preventDefault();
      moveLocaleFocus(langSegButtons.length - 1);
    } else if (e.key === " " || e.key === "Enter") {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
      const idx = btn ? langSegButtons.indexOf(btn) : -1;
      if (idx < 0) return;
      e.preventDefault(); // Prevent double-commit from native button click
      commitLocale(idx);
    }
  }

  // When editing either field, write both fields' current values together so neither clobbers the other.
  function handleFillerTextareaInput(): void {
    if (!fillerSettings) return;
    const lang = fillerSettings.get().language;
    fillerSettings.setCustomPool(lang, {
      first: parseFillerLines(fillerFirstTextareaEl),
      repeat: parseFillerLines(fillerRepeatTextareaEl),
    });
  }

  function handleVoiceSwitchClick(): void {
    const current = voiceStatus.get().state !== "idle";
    log.info("voice_input_toggle", { on: !current });
    voiceStatus.set(current ? "idle" : "listening");
  }

  // With OpenAI engine, speaker management is inactive — gates programmatic clicks (tests) too.
  function speakerControlsEnabled(): boolean {
    return reflect.effectiveProvider() === "irodori";
  }

  function handlePopOut(): void {
    onPopOut?.();
  }

  // ── Chat section: reasoning-effort segment ──

  function selectEffort(index: number, focus = false): void {
    const clamped = Math.min(REASONING_EFFORTS.length - 1, Math.max(0, index));
    const effort = REASONING_EFFORTS[clamped];
    agentSettings.setReasoningEffort(effort);
    log.info("reasoning_effort_change", { effort });
    // Store subscription will call reflect.reflectAgent to update visuals/aria.
    if (focus) segButtons[clamped]?.focus();
  }

  function handleSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    selectEffort(segButtons.indexOf(btn));
  }

  function handleSegKeydown(e: KeyboardEvent): void {
    const current = segButtons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const base = current < 0 ? 0 : current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectEffort(base + 1, true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectEffort(base - 1, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectEffort(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectEffort(REASONING_EFFORTS.length - 1, true);
    }
  }

  // ── Chat section: instructions textarea ──

  function handleInstructionsInput(): void {
    agentSettings.setInstructions(instructionsEl.value);
    log.info("instructions_change", { length: instructionsEl.value.length });
  }

  // On blur, reflect pending remote changes from mid-edit.
  function handleInstructionsBlur(): void {
    reflect.reflectAgent();
  }

  function handleResetInstructions(): void {
    agentSettings.setInstructions("");
    instructionsEl.value = "";
    log.info("instructions_reset");
  }

  function handleResetViewpoint(): void {
    onResetViewpoint?.();
    log.info("viewpoint_reset");
  }

  // ── Session section: start fresh (reset) ──

  function showSessionConfirm(): void {
    if (sessionConfirmEl) sessionConfirmEl.hidden = false;
    if (sessionResetBtn) sessionResetBtn.hidden = true;
  }

  function hideSessionConfirm(): void {
    if (sessionConfirmEl) sessionConfirmEl.hidden = true;
    if (sessionResetBtn) sessionResetBtn.hidden = false;
  }

  function handleSessionReset(): void {
    sessionStore?.clear();
    sessionDiagnostics?.clear();
    transcript?.clear();
    hideSessionConfirm();
    log.info("session_reset");
  }

  // ── Gain slider ──

  function handleGainInput(): void {
    const v = parseFloat(gainSlider.value);
    lipsync.setGain(v); // On value change, lipsync subscription calls reflect.reflectGain to redraw gain row
    gainPreviewing = true;
    onGainPreview(previewMouth(v));
  }

  function handleGainEnd(): void {
    if (gainPreviewing) {
      onGainPreviewEnd();
      gainPreviewing = false;
    }
    log.info("mouth_gain_change", { gain: parseFloat(gainSlider.value) });
  }

  // ── Silence threshold (VAD) slider ──

  function handleVadInput(): void {
    const ms = parseInt(vadSlider.value, 10);
    vad.setSilenceMs(ms); // Store subscription calls reflect.reflectVad to redraw value row
  }

  function handleVadEnd(): void {
    log.info("vad_silence_change", { silenceMs: parseInt(vadSlider.value, 10) });
  }

  // ── Tab switching ──
  // Toggle aria-selected/hidden + roving tabindex only. Arrows (←/→/Home/End) activate immediately.

  function selectTab(index: number, focus = false): void {
    const clamped = Math.min(tabButtons.length - 1, Math.max(0, index));
    tabButtons.forEach((tab, i) => {
      const on = i === clamped;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      const panel = el.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = !on;
    });
    tablistEl.style.setProperty("--tab", String(clamped));
    if (focus) tabButtons[clamped]?.focus();
  }

  function handleTabClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-tab");
    if (!btn) return;
    selectTab(tabButtons.indexOf(btn));
  }

  // ── Section rail collapse/expand ──

  function handleRailCollapseClick(): void {
    const collapsed = !railColsEl.classList.contains("is-rail-collapsed");
    railColsEl.classList.toggle("is-rail-collapsed", collapsed);
    railCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
    const label = t(collapsed ? "panel.rail_expand" : "panel.rail_collapse");
    railCollapseBtn.setAttribute("aria-label", label);
    railCollapseBtn.title = label;
    railCollapsedSettings?.setCollapsed(collapsed);
    log.info("rail_collapse_toggle", { collapsed });
  }

  function handleTabKeydown(e: KeyboardEvent): void {
    const current = tabButtons.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const base = current < 0 ? 0 : current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectTab((base + 1) % tabButtons.length, true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectTab((base - 1 + tabButtons.length) % tabButtons.length, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectTab(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectTab(tabButtons.length - 1, true);
    }
  }

  // ── Subscriptions ──

  const unsubscribe = settings.subscribe((s) => {
    if (!popover.isOpen()) return;
    switchBtn.setAttribute("aria-checked", String(s.enabled));
    el.classList.toggle("is-on", s.enabled);
    if (s.enabled && !monitorsSection.isLoaded()) {
      void monitorsSection.load();
    }
  });
  const unsubscribeIdleThrottle = idleThrottleSettings.subscribe(() => {
    if (popover.isOpen()) reflect.reflectIdleThrottle();
  });
  const unsubscribeTts = ttsSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectTts();
  });
  const unsubscribeGaze = gazeSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectGaze();
  });
  const unsubscribeAgentNotify = agentNotifySettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectAgentNotify();
  });
  const unsubscribePresence = presenceSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectPresence();
  });
  const unsubscribeRecentApps = recentAppsSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectRecentApps();
  });

  function handleAgentPortChange(): void {
    if (!agentNotifySettings || !agentPortInput) return;
    agentNotifySettings.setPort(Math.round(Number(agentPortInput.value)));
    reflect.reflectAgentNotify();
  }
  function handlePresenceChange(): void {
    if (!presenceSettings || !presenceInput) return;
    const v = Math.round(Number(presenceInput.value));
    presenceSettings.setPresentMaxIdleMs(v * 1000);
    reflect.reflectPresence();
  }
  function handleRecentAppsChange(): void {
    if (!recentAppsSettings || !recentAppsInput) return;
    const v = Math.round(Number(recentAppsInput.value));
    recentAppsSettings.setRecentAppsMax(v);
    reflect.reflectRecentApps();
  }
  agentPortInput?.addEventListener("change", handleAgentPortChange);
  presenceInput?.addEventListener("change", handlePresenceChange);
  recentAppsInput?.addEventListener("change", handleRecentAppsChange);

  // Cue-list components — schedule in input tab .yui-cue-sections, proactive in Reactions tab .yui-loop-cue-section.
  const loopCueMountEl = el.querySelector<HTMLDivElement>(".yui-loop-cue-section")!;

  let scheduleCueList: CueListInstance | null = null;
  let proactiveCueList: CueListInstance | null = null;

  function mountCueLists(): void {
    cueSectionsMountEl.innerHTML = "";
    scheduleCueList = createCueList({
      mount: cueSectionsMountEl,
      store: scheduleSettings,
      title: t("cue.schedule_title"),
      sub: t("cue.schedule_sub"),
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: t("cue.schedule_add"),
    });
    loopCueMountEl.innerHTML = "";
    proactiveCueList = createCueList({
      mount: loopCueMountEl,
      store: proactiveSettings,
      title: t("cue.proactive_title"),
      sub: t("cue.proactive_sub"),
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: t("cue.proactive_add"),
    });
  }

  mountCueLists();

  const unsubscribeVoice = voiceStatus.subscribe(reflect.reflectVoiceStatus);
  const unsubscribeLipsync = lipsync.subscribe(() => {
    if (popover.isOpen()) reflect.reflectGain();
  });
  const unsubscribeVad = vad.subscribe(() => {
    if (popover.isOpen()) reflect.reflectVad();
  });
  const unsubscribeAgent = agentSettings.subscribe(() => {
    if (popover.isOpen()) reflect.reflectAgent();
  });
  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectEndpoints();
      reflect.reflectVoiceEngine();
      reflect.reflectChatType();
      // If provider change flips speaker activation, redraw list to re-evaluate disabled state.
      const nowSpkEnabled = speakerControlsEnabled();
      if (nowSpkEnabled !== lastSpkEnabled) {
        lastSpkEnabled = nowSpkEnabled;
        speakerList.render();
      }
    }
  });
  // Reflect thinking-filler store updates to section (includes other-window reloadFromStorage).
  const unsubscribeFiller = fillerSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectFiller();
  });
  // Reflect store updates (direct select · other-window reloadFromStorage) to active row.
  // Skip during swap — finally's renderVrms handles final render after loading.
  const unsubscribeVrm = vrmSelection.subscribe(() => {
    if (popover.isOpen() && !vrmList.isSwapping()) vrmList.render();
  });
  // Reflect speaker store updates (direct select · other-window reloadFromStorage) to active row.
  // Skip during swap — finally's renderSpeakers handles final render after loading.
  const unsubscribeSpk = speakerSelection.subscribe(() => {
    if (popover.isOpen() && !speakerList.isSwapping()) speakerList.render();
  });
  // Reflect session diagnostics updates (this window's reset · pet window's reloadFromStorage) to readout.
  const unsubscribeSession = sessionDiagnostics?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSession();
  });

  switchBtn.addEventListener("click", handleSwitchClick);
  idleThrottleSwitchBtn.addEventListener("click", handleIdleThrottleSwitchClick);
  ttsSwitchBtn?.addEventListener("click", handleTtsSwitchClick);
  bargeInSwitchBtn?.addEventListener("click", handleBargeInSwitchClick);
  gazeSwitchBtn?.addEventListener("click", handleGazeSwitchClick);
  agentNotifySwitchBtn?.addEventListener("click", handleAgentNotifySwitchClick);
  fillerSwitchBtn?.addEventListener("click", handleFillerSwitchClick);
  fillerLangSegEl?.addEventListener("click", handleFillerLangClick);
  fillerLangSegEl?.addEventListener("keydown", handleFillerLangKeydown);
  langSegEl.addEventListener("click", handleLangSegClick);
  langSegEl.addEventListener("keydown", handleLangSegKeydown);
  fillerFirstTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerRepeatTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);
  gainSlider.addEventListener("input", handleGainInput);
  gainSlider.addEventListener("pointerup", handleGainEnd);
  gainSlider.addEventListener("blur", handleGainEnd);
  vadSlider.addEventListener("input", handleVadInput);
  vadSlider.addEventListener("pointerup", handleVadEnd);
  vadSlider.addEventListener("blur", handleVadEnd);
  tablistEl.addEventListener("click", handleTabClick);
  tablistEl.addEventListener("keydown", handleTabKeydown);
  railCollapseBtn.addEventListener("click", handleRailCollapseClick);
  segEl.addEventListener("click", handleSegClick);
  segEl.addEventListener("keydown", handleSegKeydown);
  vrmsEl.addEventListener("keydown", vrmList.handleKeydown);
  vrmAddBtn.addEventListener("click", vrmList.handleAddClick);
  spksEl.addEventListener("keydown", speakerList.handleKeydown);
  spkAddBtn.addEventListener("click", speakerList.handleAddClick);
  instructionsEl.addEventListener("input", handleInstructionsInput);
  instructionsEl.addEventListener("blur", handleInstructionsBlur);
  resetBtn.addEventListener("click", handleResetInstructions);
  viewpointResetBtn?.addEventListener("click", handleResetViewpoint);
  sessionResetBtn?.addEventListener("click", showSessionConfirm);
  sessionConfirmBtn?.addEventListener("click", handleSessionReset);
  sessionCancelBtn?.addEventListener("click", hideSessionConfirm);
  popOutBtn?.addEventListener("click", handlePopOut);
  closeBtn?.addEventListener("click", popover.close);
  // window variant is always visible, so open it immediately.
  if (isWindow) popover.open();

  function dispose(): void {
    disposed = true;
    endpoints.dispose();
    workflows.dispose();
    scheduleCueList?.destroy();
    proactiveCueList?.destroy();
    unsubscribe();
    unsubscribeIdleThrottle();
    unsubscribeTts?.();
    unsubscribeGaze?.();
    unsubscribeAgentNotify?.();
    unsubscribePresence?.();
    unsubscribeRecentApps?.();
    agentPortInput?.removeEventListener("change", handleAgentPortChange);
    presenceInput?.removeEventListener("change", handlePresenceChange);
    recentAppsInput?.removeEventListener("change", handleRecentAppsChange);
    unsubscribeVoice();
    unsubscribeLipsync();
    unsubscribeVad();
    unsubscribeAgent();
    unsubscribeEndpoints();
    unsubscribeFiller?.();
    unsubscribeVrm();
    unsubscribeSpk();
    unsubscribeSession?.();
    speakerList.dispose();
    popover.dispose();
    switchBtn.removeEventListener("click", handleSwitchClick);
    idleThrottleSwitchBtn.removeEventListener("click", handleIdleThrottleSwitchClick);
    ttsSwitchBtn?.removeEventListener("click", handleTtsSwitchClick);
    bargeInSwitchBtn?.removeEventListener("click", handleBargeInSwitchClick);
    gazeSwitchBtn?.removeEventListener("click", handleGazeSwitchClick);
    agentNotifySwitchBtn?.removeEventListener("click", handleAgentNotifySwitchClick);
    fillerSwitchBtn?.removeEventListener("click", handleFillerSwitchClick);
    fillerLangSegEl?.removeEventListener("click", handleFillerLangClick);
    fillerLangSegEl?.removeEventListener("keydown", handleFillerLangKeydown);
    langSegEl.removeEventListener("click", handleLangSegClick);
    langSegEl.removeEventListener("keydown", handleLangSegKeydown);
    fillerFirstTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerRepeatTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
    gainSlider.removeEventListener("input", handleGainInput);
    gainSlider.removeEventListener("pointerup", handleGainEnd);
    gainSlider.removeEventListener("blur", handleGainEnd);
    vadSlider.removeEventListener("input", handleVadInput);
    vadSlider.removeEventListener("pointerup", handleVadEnd);
    vadSlider.removeEventListener("blur", handleVadEnd);
    tablistEl.removeEventListener("click", handleTabClick);
    tablistEl.removeEventListener("keydown", handleTabKeydown);
    railCollapseBtn.removeEventListener("click", handleRailCollapseClick);
    segEl.removeEventListener("click", handleSegClick);
    segEl.removeEventListener("keydown", handleSegKeydown);
    vrmsEl.removeEventListener("keydown", vrmList.handleKeydown);
    vrmAddBtn.removeEventListener("click", vrmList.handleAddClick);
    spksEl.removeEventListener("keydown", speakerList.handleKeydown);
    spkAddBtn.removeEventListener("click", speakerList.handleAddClick);
    instructionsEl.removeEventListener("input", handleInstructionsInput);
    instructionsEl.removeEventListener("blur", handleInstructionsBlur);
    resetBtn.removeEventListener("click", handleResetInstructions);
    viewpointResetBtn?.removeEventListener("click", handleResetViewpoint);
    sessionResetBtn?.removeEventListener("click", showSessionConfirm);
    sessionConfirmBtn?.removeEventListener("click", handleSessionReset);
    sessionCancelBtn?.removeEventListener("click", hideSessionConfirm);
    popOutBtn?.removeEventListener("click", handlePopOut);
    closeBtn?.removeEventListener("click", popover.close);
    el.remove();
    scrimEl.remove();
  }

  return { el, open: popover.open, close: popover.close, isOpen: popover.isOpen, dispose };
}
