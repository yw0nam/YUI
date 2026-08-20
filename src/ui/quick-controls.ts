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
import type { ExpressMotionSettingsStore } from "../io/express-motion-settings";
import type { createFillerSettings } from "../io/filler-settings";
import type { GuardrailsSettingsStore, RateLimitOverrides } from "../io/guardrails-settings";
import type { IdleMotionSettingsStore, IdleVariantPool } from "../io/idle-motion-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../io/lipsync-settings";
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../io/persisted-store";
import type { createProactiveSettings } from "../io/proactive-settings";
import type { createScheduleSettings } from "../io/schedule-settings";
import type { ScreenKnobSettingsStore, ScreenOverrides } from "../io/screen-settings";
import type { ScreenSourceProvider } from "../io/screen-source-provider";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import type { createSessionDiagnosticsStore } from "../io/session-diagnostics";
import type { createSessionStore } from "../io/session-store";
import type { createSpeakerSelection, SpeakerOption } from "../io/speaker-selection";
import { type createVadSettings, VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../io/vad-settings";
import type { createVrmSelection } from "../io/vrm-selection";
import type { createWorkflowSettings } from "../io/workflow-settings";
import { createLogger } from "../logger";
import { type CueListInstance, createCueList } from "./cue-list";
import { type Locale, setLocale, t } from "./i18n";
import {
  type QuickControlsTab,
  RATE_LIMIT_FIELDS,
  SCREEN_KNOB_FIELDS,
  SCREEN_MIN_GAP_MAX,
  SCREEN_MIN_GAP_MIN,
  SCREEN_WATCH_SVG,
  type ScreenKnobFieldDef,
} from "./quick-controls/constants";
import { createEndpointsSection } from "./quick-controls/endpoints-section";
import { createExpressMotionList } from "./quick-controls/express-motion-section";
import { createHistorySection } from "./quick-controls/history-section";
import { createIdleMotionList } from "./quick-controls/idle-motion-section";
import { createMonitorsSection } from "./quick-controls/monitors-section";
import { createPopover } from "./quick-controls/popover";
import { createReflect } from "./quick-controls/reflect";
import { createSpeakerList } from "./quick-controls/speaker-list";
import type { SwitchRow } from "./quick-controls/switch-row";
import { buildPanelHtml } from "./quick-controls/template";
import { createVrmList } from "./quick-controls/vrm-list";
import { createWorkflowsSection } from "./quick-controls/workflows-section";
import type { VoiceInputStatus } from "./voice-input-status";

// formatTokenCount lives in reflect layer — re-exported for public API compatibility.
export { formatTokenCount } from "./quick-controls/reflect";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type ScheduleSettingsStore = ReturnType<typeof createScheduleSettings>;
type WorkflowSettingsStore = ReturnType<typeof createWorkflowSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type VadSettingsStore = ReturnType<typeof createVadSettings>;
type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type FillerSettingsStore = ReturnType<typeof createFillerSettings>;
type VrmSelectionStore = ReturnType<typeof createVrmSelection>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;
type SessionDiagnosticsStore = ReturnType<typeof createSessionDiagnosticsStore>;
type SessionStore = ReturnType<typeof createSessionStore>;
type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;

interface QuickControlsOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  /** Idle power-save (30fps cap) on/off store. When off, always full frame. */
  idleThrottleSettings: FlagSettingsStore;
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
  /** Import pick step: opens the file picker, returns the source path + a naming-row seed (null on cancel). */
  pickVoiceImport: () => Promise<{ srcPath: string; seedName: string } | null>;
  /** Import commit step: copy + register under the typed name → addUserOption + select. Inline error on reject. */
  commitVoiceImport: (srcPath: string, name: string) => Promise<void>;
  /** Delete imported voice's app-data file (idempotent). Called separately from store removal. */
  removeUserVoice: (id: string) => Promise<void>;
  /** Refetches the TTS server's voice list on panel open (the server may come up after the app). Fire-and-forget. */
  refreshVoiceList?: () => void;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  /** Reset the camera viewpoint (orbit angles) to head-on. Renders the section when set. */
  onResetViewpoint?: () => void;
  onPopOut?: () => void;
  onOpenDevtools?: () => void;
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
  /** Default bundled-config value for Chat API dropdown when no override (undefined if not loaded). */
  getDefaultChatApi?: () => string | undefined;
  /** Session diagnostics (context usage · last compression). The occupancy readout renders in the window variant only. */
  sessionDiagnostics?: SessionDiagnosticsStore;
  /** Current session id pointer. "Start fresh" clears it along with diagnostics. */
  sessionStore?: SessionStore;
  /** Unified conversation transcript. Feeds the History tab; "Start fresh" closes the running session in it. */
  transcript?: Pick<ChatHistoryStore, "startNewSession" | "sessions" | "subscribe">;
  /** Thinking filler settings store. If absent, section won't render (injected by unified agent). */
  fillerSettings?: FillerSettingsStore;
  /** TTS speech output on/off store. */
  ttsSettings?: FlagSettingsStore;
  /** Cursor gaze (eye contact) on/off store. If absent, that toggle row won't render. */
  gazeSettings?: FlagSettingsStore;
  /** Agent notification on/off store. If absent, that toggle row won't render. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** "Keep bubble until dismissed" on/off store. If absent, that toggle row won't render. */
  bubblePersistSettings?: FlagSettingsStore;
  /** Away detection store. If absent, presence row in Reactions tab won't render. */
  presenceSettings?: ClampedIntSettingsStore;
  /** Global proactive gap store. If absent, that row in the Reactions tab won't render. */
  pacerGapSettings?: ClampedIntSettingsStore;
  /** Guardrail rate-limit overrides. If absent, the cap rows in Reactions tab won't render. */
  rateLimitSettings?: GuardrailsSettingsStore;
  /** Bundled config caps shown when a field carries no override (undefined if not loaded). */
  getRateLimitDefaults?: () => RateLimitOverrides | undefined;
  /** Screen-watch on/off store. If absent, the screen-watch section won't render. */
  screenSettings?: FlagSettingsStore;
  /** Screen-watch threshold overrides. If absent, the knob group won't be editable. */
  screenKnobSettings?: ScreenKnobSettingsStore;
  /** Bundled config thresholds shown when a knob carries no override (undefined if not loaded). */
  getScreenDefaults?: () => ScreenOverrides | undefined;
  /** Section rail collapse state store. */
  railCollapsedSettings?: FlagSettingsStore;
  /** Per-variant idle-motion on/off store. If absent, the idle-motion section won't render. */
  idleMotionSettings?: IdleMotionSettingsStore;
  /** The read-only `idle` catalog entry backing that section (undefined until configs load). */
  getIdlePool?: () => IdleVariantPool | undefined;
  /** Per-motion express-motion on/off store. If absent, the express-motion section won't render. */
  expressMotionSettings?: ExpressMotionSettingsStore;
  /** Agent-triggerable motion ids backing that section (empty until configs load). */
  getExpressMotions?: () => readonly string[];
}

interface QuickControls {
  el: HTMLElement;
  /** Summon the panel. `tab` lands on that tab instead of the one last left selected. */
  open(anchor?: { x: number; y: number }, opts?: { tab?: QuickControlsTab }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

type SwitchRowOptions = Pick<
  QuickControlsOptions,
  | "idleThrottleSettings"
  | "ttsSettings"
  | "vad"
  | "gazeSettings"
  | "agentNotifySettings"
  | "fillerSettings"
  | "bubblePersistSettings"
  | "screenSettings"
  | "screenKnobSettings"
>;

export function createSwitchRows({
  idleThrottleSettings,
  ttsSettings,
  vad,
  gazeSettings,
  agentNotifySettings,
  fillerSettings,
  bubblePersistSettings,
  screenSettings,
  screenKnobSettings,
}: SwitchRowOptions): SwitchRow[] {
  return [
    {
      selector: ".yui-screen-switch",
      labelKey: "screen.label",
      subKey: "screen.sub",
      ariaKey: "screen.aria",
      tab: "react",
      position: "screen",
      labelIcon: SCREEN_WATCH_SVG,
      // Paired with the knob store: a toggle whose thresholds cannot be edited is a dead half-section.
      isVisible: !!screenSettings && !!screenKnobSettings,
      isAvailable: !!screenSettings && !!screenKnobSettings,
      initialEnabled: screenSettings?.get().enabled ?? false,
      getEnabled: () => screenSettings!.get().enabled,
      setEnabled: (v) => screenSettings!.setEnabled(v),
      logKey: "screen_watch_toggle",
    },
    {
      selector: ".yui-idle-throttle-switch",
      labelKey: "perf.idle_label",
      subKey: "perf.idle_sub",
      ariaKey: "perf.idle_aria",
      tab: "advanced",
      isVisible: true,
      isAvailable: true,
      initialEnabled: false,
      getEnabled: () => idleThrottleSettings.get().enabled,
      setEnabled: (v) => idleThrottleSettings.setEnabled(v),
      logKey: "idle_throttle_toggle",
    },
    {
      selector: ".yui-tts-switch",
      labelKey: "tts_output.label",
      subKey: "tts_output.sub",
      ariaKey: "tts_output.aria",
      tab: "input",
      labelIcon: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <rect x="4" y="6" width="16" height="12" rx="2" stroke="currentColor" stroke-width="1.7"/>
  <path d="M9 10l2.5 2.5L15 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M4 9h2M18 9h2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
</svg>`,
      isVisible: true,
      isAvailable: !!ttsSettings,
      initialEnabled: ttsSettings?.get().enabled ?? true,
      getEnabled: () => ttsSettings!.get().enabled,
      setEnabled: (v) => ttsSettings!.setEnabled(v),
      logKey: "tts_output_toggle",
    },
    {
      selector: ".yui-bargein-switch",
      labelKey: "voice_input.bargein_label",
      ariaKey: "voice_input.bargein_aria",
      tab: "input",
      position: "after-vad",
      isVisible: true,
      isAvailable: true,
      initialEnabled: vad.get().bargeIn,
      getEnabled: () => vad.get().bargeIn,
      setEnabled: (v) => vad.setBargeIn(v),
      logKey: "bargein_toggle",
    },
    {
      selector: ".yui-bubble-persist-switch",
      labelKey: "bubble_persist.label",
      subKey: "bubble_persist.sub",
      ariaKey: "bubble_persist.aria",
      tab: "input",
      position: "after-vad",
      isVisible: !!bubblePersistSettings,
      isAvailable: !!bubblePersistSettings,
      initialEnabled: bubblePersistSettings?.get().enabled ?? false,
      getEnabled: () => bubblePersistSettings!.get().enabled,
      setEnabled: (v) => bubblePersistSettings!.setEnabled(v),
      logKey: "bubble_persist_toggle",
    },
    {
      selector: ".yui-gaze-switch",
      labelKey: "gaze.label",
      subKey: "gaze.sub",
      ariaKey: "gaze.aria",
      tab: "advanced",
      isVisible: !!gazeSettings,
      isAvailable: !!gazeSettings,
      initialEnabled: gazeSettings?.get().enabled ?? false,
      getEnabled: () => gazeSettings!.get().enabled,
      setEnabled: (v) => gazeSettings!.setEnabled(v),
      logKey: "gaze_toggle",
    },
    {
      selector: ".yui-agentnotify-switch",
      labelKey: "agentNotify.label",
      subKey: "agentNotify.sub",
      ariaKey: "agentNotify.aria",
      tab: "react",
      accessory: "agent-port",
      isVisible: !!agentNotifySettings,
      isAvailable: !!agentNotifySettings,
      initialEnabled: agentNotifySettings?.get().enabled ?? false,
      getEnabled: () => agentNotifySettings!.get().enabled,
      setEnabled: (v) => agentNotifySettings!.setEnabled(v),
      logKey: "agent_notify_toggle",
    },
    {
      selector: ".yui-filler-switch",
      labelKey: "filler.enable_label",
      subKey: "filler.enable_sub",
      ariaKey: "filler.enable_label",
      tab: "talk",
      position: "filler",
      isVisible: !!fillerSettings,
      isAvailable: !!fillerSettings,
      initialEnabled: false,
      getEnabled: () => fillerSettings!.get().enabled,
      setEnabled: (v) => fillerSettings!.setEnabled(v),
    },
  ];
}

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
  pickVoiceImport,
  commitVoiceImport,
  removeUserVoice,
  refreshVoiceList,
  onGainPreview,
  onGainPreviewEnd,
  onResetViewpoint,
  onPopOut,
  onOpenDevtools,
  variant = "popover",
  onCloseWindow,
  getDefaultInstructions,
  endpointsSettings,
  chatKeySettings,
  sttKeySettings,
  ttsKeySettings,
  getEndpointDefaults,
  getDefaultChatApi,
  sessionDiagnostics,
  sessionStore,
  transcript,
  fillerSettings,
  ttsSettings,
  gazeSettings,
  agentNotifySettings,
  bubblePersistSettings,
  presenceSettings,
  pacerGapSettings,
  rateLimitSettings,
  getRateLimitDefaults,
  screenSettings,
  screenKnobSettings,
  getScreenDefaults,
  railCollapsedSettings,
  idleMotionSettings,
  getIdlePool,
  expressMotionSettings,
  getExpressMotions,
}: QuickControlsOptions): QuickControls {
  const isWindow = variant === "window";
  // Context-occupancy readout renders only in the settings window, when both stores are injected.
  const hasSession = isWindow && !!sessionDiagnostics && !!sessionStore;
  // Start fresh lives under the History tab's session list — both variants get it once the stores are there.
  const showSessionReset = !!transcript && !!sessionDiagnostics && !!sessionStore;
  // Use variant tag to distinguish which window created logs (Tauri merges both window logs to one file).
  const log = createLogger(isWindow ? "settings-ui" : "quick-ui");

  // scrim (outer click detection) only used in popover variant.
  const scrimEl = document.createElement("div");
  scrimEl.className = "yui-quick-scrim";

  const el = document.createElement("div");
  el.className = isWindow ? "yui-quick yui-quick--window" : "yui-quick";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", t("panel.dialog_label"));

  const TOGGLE_SPECS = createSwitchRows({
    idleThrottleSettings,
    ttsSettings,
    vad,
    gazeSettings,
    agentNotifySettings,
    fillerSettings,
    bubblePersistSettings,
    screenSettings,
    screenKnobSettings,
  });

  el.innerHTML = buildPanelHtml({
    isWindow,
    hasSession,
    showSessionReset,
    showViewpoint: !!onResetViewpoint,
    showIdleMotion: !!idleMotionSettings,
    showExpressMotion: !!expressMotionSettings,
    switchRows: TOGGLE_SPECS,
    showScreen: !!screenSettings && !!screenKnobSettings,
    showPresence: !!presenceSettings,
    showPacerGap: !!pacerGapSettings,
    showRateLimits: !!rateLimitSettings,
    showDevtools: !isWindow && !!onOpenDevtools,
    showHistory: !!transcript,
    railCollapsed: railCollapsedSettings?.get().enabled ?? false,
  });

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
  const agentPortInput = el.querySelector<HTMLInputElement>("#yui-agent-port");
  const presenceInput = el.querySelector<HTMLInputElement>("#yui-presence");
  const pacerGapInput = el.querySelector<HTMLInputElement>("#yui-pacer-gap");
  const rateLimitInputs = new Map<keyof RateLimitOverrides, HTMLInputElement>();
  for (const field of RATE_LIMIT_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) rateLimitInputs.set(field.key, input);
  }
  const screenKnobInputs = new Map<ScreenKnobFieldDef["key"], HTMLInputElement>();
  for (const field of SCREEN_KNOB_FIELDS) {
    const input = el.querySelector<HTMLInputElement>(`#${field.id}`);
    if (input) screenKnobInputs.set(field.key, input);
  }
  const screenGapSlider = el.querySelector<HTMLInputElement>(".yui-screen-gap__slider");
  const screenGapValue = el.querySelector<HTMLSpanElement>(".yui-screen-gap__value");
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const monitorsSection = createMonitorsSection({ root: el, sourceProvider, settings, log });
  const vrmsEl = el.querySelector<HTMLDivElement>(".yui-vrms")!;
  const vrmAddBtn = el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
  const spksEl = el.querySelector<HTMLDivElement>(".yui-spks")!;
  const gainSlider = el.querySelector<HTMLInputElement>(".yui-lipsync-gain__slider")!;
  const vadSlider = el.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const tablistEl = el.querySelector<HTMLDivElement>(".yui-tabs")!;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab"));
  const railColsEl = el.querySelector<HTMLDivElement>(".yui-quick__cols")!;
  const railCollapseBtn = el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
  const barEl = el.querySelector<HTMLDivElement>(".yui-quick__bar");
  const popOutBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout");
  const devtoolsBtn = el.querySelector<HTMLButtonElement>(".yui-devtools-open");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");
  const segEl = el.querySelector<HTMLDivElement>(".yui-field-row .yui-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const spkAddBtn = el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;
  // Viewpoint reset button — exists only when onResetViewpoint is injected (null otherwise).
  const viewpointResetBtn = el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset");
  // Thinking filler section node — exists only when fillerSettings is injected (null otherwise).
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

  // History tab (transcript viewer) — rendered only when a transcript store is injected.
  const history = transcript
    ? createHistorySection({ root: el, transcript, isOpen: () => popover.isOpen() })
    : null;

  // Start-fresh footer nodes in the History tab (null when the reset stores are absent).
  const sessionResetBtn = el.querySelector<HTMLButtonElement>(".yui-session__reset");
  // Cue rows also use the .yui-confirm pattern, so scope the session's specifically.
  const sessionConfirmEl = el.querySelector<HTMLDivElement>(".yui-hist__action .yui-confirm");
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

  // ── reflect (store→DOM sync) layer ──
  const reflect = createReflect({
    root: el,
    switchRows: TOGGLE_SPECS,
    settings,
    agentNotifySettings,
    lipsync,
    vad,
    agentSettings,
    fillerSettings,
    endpointsSettings,
    sessionDiagnostics,
    keyRows: endpoints.keyRows,
    getEndpointDefaults,
    getDefaultChatApi,
    agentPortInput: agentPortInput ?? undefined,
    presenceInput: presenceInput ?? undefined,
    presenceSettings,
    pacerGapInput: pacerGapInput ?? undefined,
    pacerGapSettings,
    rateLimitInputs,
    rateLimitSettings,
    getRateLimitDefaults,
    screenSettings,
    screenKnobInputs,
    screenKnobSettings,
    getScreenDefaults,
  });

  // ── VRM section ──

  const vrmList = createVrmList({ root: el, vrmSelection, swapVrm, importVrm, removeUserVrm, log });

  // ── Idle motion section ──

  const idleMotionList = idleMotionSettings
    ? createIdleMotionList({
        root: el,
        settings: idleMotionSettings,
        getPool: () => getIdlePool?.(),
        log,
      })
    : undefined;

  // ── Express motion section ──

  const expressMotionList = expressMotionSettings
    ? createExpressMotionList({
        root: el,
        settings: expressMotionSettings,
        getVocabulary: () => getExpressMotions?.() ?? [],
        log,
      })
    : undefined;

  // ── Speaker section ──
  const speakerList = createSpeakerList({
    root: el,
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    pickVoiceImport,
    commitVoiceImport,
    removeUserVoice,
    log,
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
      reflect.reflectSwitchRows();
      reflect.reflectAgentNotify();
      reflect.reflectPresence();
      reflect.reflectPacerGap();
      reflect.reflectRateLimits();
      reflect.reflectScreen();
      reflect.reflectVoiceStatus(voiceStatus.get());
      reflect.reflectGain();
      reflect.reflectVad();
      reflect.reflectAgent();
      reflect.reflectFiller();
      reflect.reflectLanguage();
      reflect.reflectEndpoints();
      reflect.reflectKeyRows();
      reflect.reflectChatType();
      reflect.reflectChatPreset();
      reflect.reflectSession();
      // The confirm is static markup — disarm it so a reopen never lands on the destructive pill.
      hideSessionConfirm();
      history?.render();
      vrmList.render();
      idleMotionList?.render();
      expressMotionList?.render();
      speakerList.render();
      // Server may have come up after the app — refetch its voice list (store subscription re-renders).
      refreshVoiceList?.();
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
      endpoints.commitDirtyEndpoints();
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

  function handleToggleClick(spec: SwitchRow): void {
    if (!spec.isAvailable) return;
    const next = !spec.getEnabled();
    spec.setEnabled(next);
    if (spec.logKey) log.info(spec.logKey, { enabled: next });
  }

  // ── Thinking filler event handlers ──

  // Parse textarea rows line-by-line (trim + remove empty lines).
  function parseFillerLines(el: HTMLTextAreaElement | null): string[] {
    if (!el) return [];
    return el.value
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  // ── Shared segmented-control keyboard pattern ──
  // Arrows/Home/End always navigate (clamped by the domain's own select/move function); an optional
  // commit step handles Space/Enter separately for patterns where focus doesn't imply selection
  // (see handleLangSegKeydown). getBaseIndex lets each caller define its own "current position" —
  // by checked state for combined navigate+select segments, by focus for roving-focus-only segments.
  interface SegKeydownConfig {
    length: number;
    getBaseIndex: () => number;
    onNavigate: (index: number, focus: boolean) => void;
    onCommit?: (index: number) => void;
  }

  function handleSegmentKeydown(
    e: KeyboardEvent,
    buttons: HTMLButtonElement[],
    cfg: SegKeydownConfig,
  ): void {
    const base = cfg.getBaseIndex();
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      cfg.onNavigate(base + 1, true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      cfg.onNavigate(base - 1, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      cfg.onNavigate(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      cfg.onNavigate(cfg.length - 1, true);
    } else if (cfg.onCommit && (e.key === " " || e.key === "Enter")) {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
      const idx = btn ? buttons.indexOf(btn) : -1;
      if (idx < 0) return;
      e.preventDefault();
      cfg.onCommit(idx);
    }
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
    handleSegmentKeydown(e, fillerLangBtns, {
      length: FILLER_LANGS.length,
      getBaseIndex: () => {
        const current = fillerLangBtns.findIndex((b) => b.getAttribute("aria-checked") === "true");
        return current < 0 ? 0 : current;
      },
      onNavigate: (index, focus) => selectFillerLang(index, focus),
      onCommit: (index) => selectFillerLang(index, true),
    });
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
    handleSegmentKeydown(e, langSegButtons, {
      length: langSegButtons.length,
      // Arrow baseline: currently focused radio (else checked one, else 0).
      getBaseIndex: () => {
        const active = document.activeElement;
        const focusIdx = active instanceof HTMLButtonElement ? langSegButtons.indexOf(active) : -1;
        const checkedIdx = langSegButtons.findIndex(
          (b) => b.getAttribute("aria-checked") === "true",
        );
        return focusIdx >= 0 ? focusIdx : checkedIdx < 0 ? 0 : checkedIdx;
      },
      onNavigate: (index) => moveLocaleFocus(index),
      // Prevent double-commit from native button click — same guard as before (e.preventDefault in shared fn).
      onCommit: (index) => commitLocale(index),
    });
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
    handleSegmentKeydown(e, segButtons, {
      length: REASONING_EFFORTS.length,
      getBaseIndex: () => {
        const current = segButtons.findIndex((b) => b.getAttribute("aria-checked") === "true");
        return current < 0 ? 0 : current;
      },
      onNavigate: (index, focus) => selectEffort(index, focus),
      // No onCommit — native <button> Space/Enter already fires click (handleSegClick), matching prior behavior.
    });
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

  // Closes the running conversation: the id pointer and diagnostics reset, the transcript keeps
  // its turns behind a session boundary so the History tab can still read them.
  function handleSessionReset(): void {
    sessionStore?.clear();
    sessionDiagnostics?.clear();
    transcript?.startNewSession();
    hideSessionConfirm();
    log.info("session_reset");
  }

  // ── Shared slider input/end pattern ──
  // input: parse the raw value, commit it to the store (a subscription redraws the row), optionally
  // run an extra side effect (gain's lipsync preview). end (pointerup/blur): optionally end that side
  // effect, then always log the committed value.
  interface SliderBinding<T> {
    slider: HTMLInputElement;
    parse: (raw: string) => T;
    setValue: (v: T) => void;
    logKey: string;
    logField: string;
    onInputExtra?: (v: T) => void;
    onEndExtra?: () => void;
  }

  function bindSlider<T>(cfg: SliderBinding<T>): () => void {
    function handleInput(): void {
      const v = cfg.parse(cfg.slider.value);
      cfg.setValue(v);
      cfg.onInputExtra?.(v);
    }
    function handleEnd(): void {
      cfg.onEndExtra?.();
      log.info(cfg.logKey, { [cfg.logField]: cfg.parse(cfg.slider.value) });
    }
    cfg.slider.addEventListener("input", handleInput);
    cfg.slider.addEventListener("pointerup", handleEnd);
    cfg.slider.addEventListener("blur", handleEnd);
    return () => {
      cfg.slider.removeEventListener("input", handleInput);
      cfg.slider.removeEventListener("pointerup", handleEnd);
      cfg.slider.removeEventListener("blur", handleEnd);
    };
  }

  // ── Gain slider ──

  const disposeGainSlider = bindSlider({
    slider: gainSlider,
    parse: parseFloat,
    setValue: (v: number) => lipsync.setGain(v), // On value change, lipsync subscription calls reflect.reflectGain to redraw gain row
    logKey: "mouth_gain_change",
    logField: "gain",
    onInputExtra: (v: number) => {
      gainPreviewing = true;
      onGainPreview(previewMouth(v));
    },
    onEndExtra: () => {
      if (gainPreviewing) {
        onGainPreviewEnd();
        gainPreviewing = false;
      }
    },
  });

  // ── Silence threshold (VAD) slider ──

  const disposeVadSlider = bindSlider({
    slider: vadSlider,
    parse: (raw: string) => parseInt(raw, 10),
    setValue: (v: number) => vad.setSilenceMs(v), // Store subscription calls reflect.reflectVad to redraw value row
    logKey: "vad_silence_change",
    logField: "silenceMs",
  });

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

  function openPanel(anchor?: { x: number; y: number }, opts?: { tab?: QuickControlsTab }): void {
    const index = opts?.tab ? tabButtons.findIndex((tab) => tab.id === `yui-tab-${opts.tab}`) : -1;
    // Select before opening so the panel is positioned around the tab the caller asked for.
    if (index >= 0) selectTab(index);
    popover.open(anchor);
    // open() lands focus on the first control; move it to the tab the caller asked for.
    if (index >= 0) tabButtons[index]?.focus();
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
    railCollapsedSettings?.setEnabled(collapsed);
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
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeTts = ttsSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeGaze = gazeSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeBubblePersist = bubblePersistSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeAgentNotify = agentNotifySettings?.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectSwitchRows();
      reflect.reflectAgentNotify();
    }
  });
  const unsubscribePresence = presenceSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectPresence();
  });
  const unsubscribePacerGap = pacerGapSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectPacerGap();
  });
  const unsubscribeRateLimit = rateLimitSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectRateLimits();
  });
  const unsubscribeScreen = screenSettings?.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectSwitchRows();
      reflect.reflectScreen();
    }
  });
  const unsubscribeScreenKnobs = screenKnobSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectScreen();
  });

  function handleAgentPortChange(): void {
    if (!agentNotifySettings || !agentPortInput) return;
    agentNotifySettings.setPort(Math.round(Number(agentPortInput.value)));
    reflect.reflectAgentNotify();
  }
  function handlePresenceChange(): void {
    if (!presenceSettings || !presenceInput) return;
    const v = Math.round(Number(presenceInput.value));
    presenceSettings.set(v * 1000);
    reflect.reflectPresence();
  }
  function handlePacerGapChange(): void {
    if (!pacerGapSettings || !pacerGapInput) return;
    const v = Math.round(Number(pacerGapInput.value));
    pacerGapSettings.set(v * 60_000);
    reflect.reflectPacerGap();
  }
  // Commit on change (blur / Enter), the same settle point as the agent port — a mid-typing
  // keystroke must not re-cap the live limiter. An emptied field clears the override.
  function handleRateLimitChange(e: Event): void {
    const input = e.target;
    if (!rateLimitSettings || !(input instanceof HTMLInputElement)) return;
    const key = RATE_LIMIT_FIELDS.find((f) => f.id === input.id)?.key;
    if (!key) return;
    rateLimitSettings.set({ [key]: Math.round(Number(input.value)) });
    reflect.reflectRateLimits();
  }
  // Same settle point as the caps above: a knob commits on blur/Enter, never mid-typing.
  // An emptied field clears the override and falls back to configs/screen.json. The row's
  // min/max only bind the spinner, so a typed value is clamped here — the producer must never
  // run outside the range the row advertises.
  function handleScreenKnobChange(e: Event): void {
    const input = e.target;
    if (!screenKnobSettings || !(input instanceof HTMLInputElement)) return;
    const field = SCREEN_KNOB_FIELDS.find((f) => f.id === input.id);
    if (!field) return;
    const typed = Math.round(Number(input.value));
    const units = typed > 0 ? Math.min(Math.max(typed, field.min), field.max) : 0;
    screenKnobSettings.set({ [field.key]: units * field.unitMs });
    reflect.reflectScreen();
  }
  const screenGapMinutes = (): number =>
    Math.min(
      Math.max(Math.round(Number(screenGapSlider?.value)), SCREEN_MIN_GAP_MIN),
      SCREEN_MIN_GAP_MAX,
    );
  // Slider commits on release only — dragging must not re-time the live producer on every frame.
  function handleScreenGapInput(): void {
    if (!screenGapSlider) return;
    const minutes = screenGapMinutes();
    if (screenGapValue) screenGapValue.textContent = t("screen.min_gap_value", { n: minutes });
    screenGapSlider.style.setProperty(
      "--fill",
      String((minutes - SCREEN_MIN_GAP_MIN) / (SCREEN_MIN_GAP_MAX - SCREEN_MIN_GAP_MIN)),
    );
  }
  function handleScreenGapChange(): void {
    if (!screenKnobSettings || !screenGapSlider) return;
    screenKnobSettings.set({ min_gap_ms: screenGapMinutes() * 60_000 });
    reflect.reflectScreen();
  }
  agentPortInput?.addEventListener("change", handleAgentPortChange);
  presenceInput?.addEventListener("change", handlePresenceChange);
  presenceInput?.addEventListener("blur", reflect.reflectPresence);
  pacerGapInput?.addEventListener("change", handlePacerGapChange);
  pacerGapInput?.addEventListener("blur", reflect.reflectPacerGap);
  for (const input of rateLimitInputs.values()) {
    input.addEventListener("change", handleRateLimitChange);
    input.addEventListener("blur", reflect.reflectRateLimits);
  }
  for (const input of screenKnobInputs.values()) {
    input.addEventListener("change", handleScreenKnobChange);
    input.addEventListener("blur", reflect.reflectScreen);
  }
  screenGapSlider?.addEventListener("input", handleScreenGapInput);
  screenGapSlider?.addEventListener("change", handleScreenGapChange);

  // Cue-list components — both in the Proactive tab: proactive in .yui-loop-cue-section, schedule in .yui-cue-sections.
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
    if (popover.isOpen()) {
      reflect.reflectSwitchRows();
      reflect.reflectVad();
    }
  });
  const unsubscribeAgent = agentSettings.subscribe(() => {
    if (popover.isOpen()) reflect.reflectAgent();
  });
  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectEndpoints();
      reflect.reflectChatType();
      reflect.reflectChatPreset();
    }
  });
  // Reflect thinking-filler store updates to section (includes other-window reloadFromStorage).
  const unsubscribeFiller = fillerSettings?.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectSwitchRows();
      reflect.reflectFiller();
    }
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
  // Reflect idle-motion updates (this window's toggle · other window's reloadFromStorage) to the rows.
  const unsubscribeIdleMotion = idleMotionSettings?.subscribe(() => {
    if (popover.isOpen()) idleMotionList?.render();
  });
  // Reflect express-motion updates (this window's toggle · other window's reloadFromStorage).
  const unsubscribeExpressMotion = expressMotionSettings?.subscribe(() => {
    if (popover.isOpen()) expressMotionList?.render();
  });

  switchBtn.addEventListener("click", handleSwitchClick);
  const toggleButtons = TOGGLE_SPECS.map((spec) =>
    el.querySelector<HTMLButtonElement>(spec.selector),
  );
  const toggleClickHandlers = TOGGLE_SPECS.map((spec) => () => handleToggleClick(spec));
  toggleButtons.forEach((button, i) => {
    button?.addEventListener("click", toggleClickHandlers[i]);
  });
  fillerLangSegEl?.addEventListener("click", handleFillerLangClick);
  fillerLangSegEl?.addEventListener("keydown", handleFillerLangKeydown);
  langSegEl.addEventListener("click", handleLangSegClick);
  langSegEl.addEventListener("keydown", handleLangSegKeydown);
  fillerFirstTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerRepeatTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);
  // Gain/VAD sliders are wired inside bindSlider() above; disposeGainSlider/disposeVadSlider tear them down.
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
  devtoolsBtn?.addEventListener("click", () => onOpenDevtools?.());
  closeBtn?.addEventListener("click", popover.close);
  // window variant is always visible, so open it immediately.
  if (isWindow) popover.open();

  function dispose(): void {
    disposed = true;
    endpoints.dispose();
    workflows.dispose();
    history?.dispose();
    scheduleCueList?.destroy();
    proactiveCueList?.destroy();
    unsubscribe();
    unsubscribeIdleThrottle();
    unsubscribeTts?.();
    unsubscribeGaze?.();
    unsubscribeBubblePersist?.();
    unsubscribeAgentNotify?.();
    unsubscribePresence?.();
    unsubscribePacerGap?.();
    unsubscribeRateLimit?.();
    unsubscribeScreen?.();
    unsubscribeScreenKnobs?.();
    for (const input of screenKnobInputs.values()) {
      input.removeEventListener("change", handleScreenKnobChange);
      input.removeEventListener("blur", reflect.reflectScreen);
    }
    screenGapSlider?.removeEventListener("input", handleScreenGapInput);
    screenGapSlider?.removeEventListener("change", handleScreenGapChange);
    agentPortInput?.removeEventListener("change", handleAgentPortChange);
    presenceInput?.removeEventListener("change", handlePresenceChange);
    presenceInput?.removeEventListener("blur", reflect.reflectPresence);
    pacerGapInput?.removeEventListener("change", handlePacerGapChange);
    pacerGapInput?.removeEventListener("blur", reflect.reflectPacerGap);
    for (const input of rateLimitInputs.values()) {
      input.removeEventListener("change", handleRateLimitChange);
      input.removeEventListener("blur", reflect.reflectRateLimits);
    }
    unsubscribeVoice();
    unsubscribeLipsync();
    unsubscribeVad();
    unsubscribeAgent();
    unsubscribeEndpoints();
    unsubscribeFiller?.();
    unsubscribeVrm();
    unsubscribeSpk();
    unsubscribeSession?.();
    unsubscribeIdleMotion?.();
    unsubscribeExpressMotion?.();
    expressMotionList?.dispose();
    vrmList.dispose();
    speakerList.dispose();
    popover.dispose();
    switchBtn.removeEventListener("click", handleSwitchClick);
    toggleButtons.forEach((button, i) => {
      button?.removeEventListener("click", toggleClickHandlers[i]);
    });
    fillerLangSegEl?.removeEventListener("click", handleFillerLangClick);
    fillerLangSegEl?.removeEventListener("keydown", handleFillerLangKeydown);
    langSegEl.removeEventListener("click", handleLangSegClick);
    langSegEl.removeEventListener("keydown", handleLangSegKeydown);
    fillerFirstTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerRepeatTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
    disposeGainSlider();
    disposeVadSlider();
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

  return { el, open: openPanel, close: popover.close, isOpen: popover.isOpen, dispose };
}
