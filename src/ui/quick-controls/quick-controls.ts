/**
 * Quick-controls panel — settings panel summoned by right-click.
 * Comprises draggable header + tab strip (chat · character · input · advanced) + tab panel body.
 * variant: "popover" (default, docked in pet window + draggable) | "window" (separate OS window, full fill).
 */

import "./quick-controls.css";
import type { AvatarOption } from "../../config/load";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import type { createChatHistoryStore } from "../../io/chat/chat-history-store";
import type { DelegationItem, PushSocketState } from "../../io/chat/push-socket";
import type { createSessionDiagnosticsStore } from "../../io/chat/session-diagnostics";
import type { createSessionStore } from "../../io/chat/session-store";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import type { ScreenSourceProvider } from "../../io/window/capture/screen-source-provider";
import { createLogger } from "../../logger";
import type { ExpressMotionSettingsStore } from "../../settings/avatar/express-motion-settings";
import type {
  IdleMotionSettingsStore,
  IdleVariantPool,
} from "../../settings/avatar/idle-motion-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../../settings/avatar/lipsync-settings";
import type { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type { createAgentSettings } from "../../settings/backend/agent-settings";
import type { ApiKeySettingsStore } from "../../settings/backend/api-key-settings";
import type { ChatKeySettingsStore } from "../../settings/backend/chat-key-settings";
import type {
  createEndpointsSettings,
  EndpointOverrides,
} from "../../settings/backend/endpoints-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitOverrides,
} from "../../settings/backend/guardrails-settings";
import type { createWorkflowSettings } from "../../settings/backend/workflow-settings";
import type {
  ScreenKnobSettingsStore,
  ScreenOverrides,
} from "../../settings/capture/screen-settings";
import type { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import type { createProactiveSettings } from "../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../settings/cues/schedule-settings";
import type { MessageWindowSettingsStore } from "../../settings/panels/message-window-settings";
import type { createSectionsSettings } from "../../settings/panels/sections-settings";
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../../settings/persisted-store";
import type { createFillerSettings } from "../../settings/voice/filler-settings";
import {
  type createVadSettings,
  VAD_SILENCE_MAX,
  VAD_SILENCE_MIN,
} from "../../settings/voice/vad-settings";
import { DELEGATION_REFRESH_MS } from "../chips/delegation-rows";
import type { VoiceInputStatus } from "../chips/voice-input-status";
import { t } from "../i18n";
import { type CueListInstance, createCueList } from "../message/cue-list";
import { createSections } from "./collapsible-sections";
import type { QuickControlsTab } from "./constants";
import { createHintTooltip } from "./hint-tooltip";
import { createPopover } from "./popover";
import { createReflect } from "./reflect";
import { createAgentSection } from "./sections/agent-section";
import { createEndpointsSection } from "./sections/endpoints-section";
import { createExpressMotionList } from "./sections/express-motion-section";
import { parseToolLines, serializeToolLines } from "./sections/filler-tool-lines";
import { createHistorySection } from "./sections/history-section";
import { createIdleMotionList } from "./sections/idle-motion-section";
import { createMonitorsSection } from "./sections/monitors-section";
import { createReactionsSection } from "./sections/reactions-section";
import { createScreenSection } from "./sections/screen-section";
import { createSpeakerList } from "./sections/speaker-list";
import { createVrmList } from "./sections/vrm-list";
import { createWorkflowsSection } from "./sections/workflows-section";
import { handleSegmentKeydown } from "./seg-keyboard";
import { bindSlider } from "./slider-binding";
import { createSwitchRows, type SwitchRow } from "./switch-row";
import { buildPanelHtml } from "./template";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type ScheduleSettingsStore = ReturnType<typeof createScheduleSettings>;
type WorkflowSettingsStore = ReturnType<typeof createWorkflowSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type VadSettingsStore = ReturnType<typeof createVadSettings>;
type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type SectionsSettingsStore = ReturnType<typeof createSectionsSettings>;
type FillerSettingsStore = ReturnType<typeof createFillerSettings>;
type VrmSelectionStore = ReturnType<typeof createVrmSelection>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;
type SessionDiagnosticsStore = ReturnType<typeof createSessionDiagnosticsStore>;
type SessionStore = ReturnType<typeof createSessionStore>;
type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;

/** The push transport as the settings panel uses it: a state to show and a conversation to reset. */
export interface PushSocketPanelPort {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
  sendReset(): boolean;
  /** Drop the backoff wait and open now — what the status line's button asks for. */
  reconnectNow(): void;
}

/** The delegations list as the settings window sees it — mirrored over the bridge. */
export interface DelegationsPanelPort {
  get(): DelegationItem[];
  subscribe(cb: (items: DelegationItem[]) => void): () => void;
  /** Ask the owner again — a mirror's only way to re-filter past its TTL without a new frame. */
  refresh?(): void;
}

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
  removeVoice: (id: string) => Promise<void>;
  /** Refetches the TTS server's voice list on panel open (the server may come up after the app). Fire-and-forget. */
  refreshVoiceList?: () => void;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  /** Reset the camera viewpoint (orbit angles) to head-on. Renders the section when set. */
  onResetViewpoint?: () => void;
  onPopOut?: () => void;
  /** Opens the text input. Renders the header button when set. */
  onMessage?: () => void;
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
  /** Push transport — the chat section shows its state, and "Start fresh" resets the conversation on it. */
  pushSocket?: PushSocketPanelPort;
  /** Stops the in-flight turn the way the stop button does, before the reset frame goes out. */
  stopTurn?: () => void;
  /** Delegated-work list for the session section (window variant). The pet window publishes it. */
  delegations?: DelegationsPanelPort;
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
  /** Ambient window-climbing on/off store. If absent, that toggle row won't render. */
  climbSettings?: FlagSettingsStore;
  /** Falling on/off store. If absent, that toggle row won't render. */
  fallSettings?: FlagSettingsStore;
  /** Agent notification on/off store. If absent, that toggle row won't render. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** "Keep bubble until dismissed" on/off store. If absent, that toggle row won't render. */
  bubblePersistSettings?: FlagSettingsStore;
  /** Docked/popped message-window mode store. If absent, that toggle row won't render. */
  messageWindowSettings?: MessageWindowSettingsStore;
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
  /** Collapsible-sections open/closed state store. */
  sectionsSettings?: SectionsSettingsStore;
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
  removeVoice,
  refreshVoiceList,
  onGainPreview,
  onGainPreviewEnd,
  onResetViewpoint,
  onPopOut,
  onMessage,
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
  pushSocket,
  stopTurn,
  delegations,
  sessionDiagnostics,
  sessionStore,
  transcript,
  fillerSettings,
  ttsSettings,
  gazeSettings,
  climbSettings,
  fallSettings,
  agentNotifySettings,
  bubblePersistSettings,
  messageWindowSettings,
  presenceSettings,
  pacerGapSettings,
  rateLimitSettings,
  getRateLimitDefaults,
  screenSettings,
  screenKnobSettings,
  getScreenDefaults,
  railCollapsedSettings,
  sectionsSettings,
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
    climbSettings,
    fallSettings,
    agentNotifySettings,
    fillerSettings,
    bubblePersistSettings,
    messageWindowSettings,
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
    showMessage: !!onMessage,
    showHistory: !!transcript,
    railCollapsed: railCollapsedSettings?.get().enabled ?? false,
    closedSections: new Set(sectionsSettings?.get().closed ?? []),
  });

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
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
  const messageBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--message");
  const devtoolsBtn = el.querySelector<HTMLButtonElement>(".yui-devtools-open");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");
  const spkAddBtn = el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
  // Viewpoint reset button — exists only when onResetViewpoint is injected (null otherwise).
  const viewpointResetBtn = el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset");
  // Thinking filler section node — exists only when fillerSettings is injected (null otherwise).
  const fillerLangSegEl = el.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const fillerFirstTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-first-textarea");
  const fillerRepeatTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-repeat-textarea",
  );
  const fillerLongWaitTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-long-wait-textarea",
  );
  const fillerTimeoutTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-timeout-textarea",
  );
  const fillerUnreachableTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-unreachable-textarea",
  );
  const fillerToolTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-tool-textarea");
  const fillerLangBtns = fillerLangSegEl
    ? Array.from(fillerLangSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];

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
  const hintTooltip = createHintTooltip({ root: el });
  const sections = createSections({ root: el, sectionsSettings });

  // History tab (transcript viewer) — rendered only when a transcript store is injected.
  const history = transcript
    ? createHistorySection({ root: el, transcript, isOpen: () => popover.isOpen() })
    : null;

  // Start-fresh footer nodes in the History tab (null when the reset stores are absent).
  const chatStatusActionBtn = el.querySelector<HTMLButtonElement>(".yui-chat-status__action")!;
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
    ...(pushSocket ? { getPushState: () => pushSocket.getState() } : {}),
    ...(delegations ? { delegations } : {}),
    presenceSettings,
    pacerGapSettings,
    rateLimitSettings,
    getRateLimitDefaults,
    screenSettings,
    screenKnobSettings,
    getScreenDefaults,
  });

  // The session section's delegated list re-renders on every list change; a once-a-minute refresh keeps
  // the elapsed text current while something is running.
  let delegationsTimer: ReturnType<typeof setInterval> | null = null;
  function syncDelegations(): void {
    reflect.reflectDelegations();
    if (!delegations) return;
    const has = delegations.get().some((item) => item.state === "running");
    if (has && delegationsTimer === null) {
      delegationsTimer = setInterval(() => {
        delegations.refresh?.();
        reflect.reflectDelegations();
      }, DELEGATION_REFRESH_MS);
    } else if (!has && delegationsTimer !== null) {
      clearInterval(delegationsTimer);
      delegationsTimer = null;
    }
  }

  // ── VRM section ──
  const vrmList = createVrmList({
    root: el,
    vrmSelection,
    swapVrm,
    importVrm,
    removeUserVrm,
    log,
    refreshTooltip: hintTooltip.refresh,
  });

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
    removeVoice,
    log,
    refreshTooltip: hintTooltip.refresh,
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
      syncDelegations();
      sections.reflect();
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

  // ── Screen section (screen-watch threshold knobs · min-gap slider) ──
  const screen = createScreenSection({
    root: el,
    screenSettings,
    screenKnobSettings,
    reflectScreen: reflect.reflectScreen,
    reflectSwitchRows: reflect.reflectSwitchRows,
    isOpen: popover.isOpen,
  });

  // ── Reactions section (agent port · presence · pacer gap · rate-limit caps) ──
  const reactions = createReactionsSection({
    root: el,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    rateLimitSettings,
    reflectAgentNotify: reflect.reflectAgentNotify,
    reflectPresence: reflect.reflectPresence,
    reflectPacerGap: reflect.reflectPacerGap,
    reflectRateLimits: reflect.reflectRateLimits,
    reflectSwitchRows: reflect.reflectSwitchRows,
    isOpen: popover.isOpen,
  });

  // ── Agent section (locale segment · reasoning-effort segment · instructions textarea) ──
  const agent = createAgentSection({
    root: el,
    agentSettings,
    getDefaultInstructions,
    reflectAgent: reflect.reflectAgent,
    reflectLanguage: reflect.reflectLanguage,
    isOpen: popover.isOpen,
    log,
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

  const FILLER_LANGS = ["ja", "en", "ko"] as const;

  // Move segment selection + focus. aria/tabindex updated by store subscription (reflectFiller).
  function selectFillerLang(index: number, focus = false): void {
    if (!fillerSettings) return;
    const clamped = Math.min(FILLER_LANGS.length - 1, Math.max(0, index));
    const lang = FILLER_LANGS[clamped];
    fillerSettings.setLanguage(lang);
    // When language changes, immediately update every textarea to new language's pool (before store subscription).
    const pool = fillerSettings.get().customPools[lang];
    if (fillerFirstTextareaEl) fillerFirstTextareaEl.value = (pool?.first ?? []).join("\n");
    if (fillerRepeatTextareaEl) fillerRepeatTextareaEl.value = (pool?.repeat ?? []).join("\n");
    if (fillerLongWaitTextareaEl)
      fillerLongWaitTextareaEl.value = (pool?.long_wait ?? []).join("\n");
    if (fillerTimeoutTextareaEl) fillerTimeoutTextareaEl.value = (pool?.timeout ?? []).join("\n");
    if (fillerUnreachableTextareaEl)
      fillerUnreachableTextareaEl.value = (pool?.unreachable ?? []).join("\n");
    if (fillerToolTextareaEl) fillerToolTextareaEl.value = serializeToolLines(pool?.tool ?? {});
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

  // When editing any one field, write every field's current value together so none clobbers another.
  function handleFillerTextareaInput(): void {
    if (!fillerSettings) return;
    const lang = fillerSettings.get().language;
    fillerSettings.setCustomPool(lang, {
      first: parseFillerLines(fillerFirstTextareaEl),
      repeat: parseFillerLines(fillerRepeatTextareaEl),
      long_wait: parseFillerLines(fillerLongWaitTextareaEl),
      timeout: parseFillerLines(fillerTimeoutTextareaEl),
      unreachable: parseFillerLines(fillerUnreachableTextareaEl),
      tool: parseToolLines(fillerToolTextareaEl?.value ?? ""),
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

  // Close first: the panel restores focus on close, and the text input must take it after.
  function handleMessage(): void {
    popover.close();
    onMessage?.();
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
  // Effective chat protocol: the user's override, else the bundled default.
  function isPushMode(): boolean {
    return (endpointsSettings.get().chat_api || getDefaultChatApi?.()) === "push";
  }

  function handleSessionReset(): void {
    // A turn still running stops with the conversation, before the reset frame goes out.
    stopTurn?.();
    sessionStore?.clear();
    sessionDiagnostics?.clear();
    transcript?.startNewSession();
    // Push mode keeps its conversation on the backend — it ends only when the frame lands.
    if (isPushMode()) pushSocket?.sendReset();
    hideSessionConfirm();
    log.info("session_reset");
  }

  // ── Gain slider ──

  const disposeGainSlider = bindSlider(
    {
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
    },
    log,
  );

  // ── Silence threshold (VAD) slider ──

  const disposeVadSlider = bindSlider(
    {
      slider: vadSlider,
      parse: (raw: string) => parseInt(raw, 10),
      setValue: (v: number) => vad.setSilenceMs(v), // Store subscription calls reflect.reflectVad to redraw value row
      logKey: "vad_silence_change",
      logField: "silenceMs",
    },
    log,
  );

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
    railCollapseBtn.dataset.tip = label;
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
  const unsubscribeClimb = climbSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeFall = fallSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeBubblePersist = bubblePersistSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
  const unsubscribeMessageWindow = messageWindowSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSwitchRows();
  });
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
  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectEndpoints();
      reflect.reflectChatType();
      reflect.reflectChatPreset();
    }
  });
  // The socket moves on its own — its line and the session section's rows follow whether or not
  // a setting changed.
  const unsubscribePushState = pushSocket?.onState(() => {
    if (popover.isOpen()) {
      reflect.reflectChatStatus();
      reflect.reflectDelegations();
    }
  });
  // Reflect thinking-filler store updates to section (includes other-window reloadFromStorage).
  const unsubscribeFiller = fillerSettings?.subscribe(() => {
    if (popover.isOpen()) {
      reflect.reflectSwitchRows();
      reflect.reflectFiller();
    }
  });
  // Reflect collapsed-sections store updates to the DOM (includes other-window reloadFromStorage).
  const unsubscribeSections = sectionsSettings?.subscribe(() => {
    if (popover.isOpen()) sections.reflect();
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
  // Reflect delegated-work updates to the session section through the same sync that arms
  // its minute refresh.
  const unsubscribeDelegations = delegations?.subscribe(() => syncDelegations());
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
  fillerFirstTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerRepeatTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerLongWaitTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerTimeoutTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerUnreachableTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerToolTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);
  // Gain/VAD sliders are wired inside bindSlider() above; disposeGainSlider/disposeVadSlider tear them down.
  tablistEl.addEventListener("click", handleTabClick);
  tablistEl.addEventListener("keydown", handleTabKeydown);
  railCollapseBtn.addEventListener("click", handleRailCollapseClick);
  vrmsEl.addEventListener("keydown", vrmList.handleKeydown);
  vrmAddBtn.addEventListener("click", vrmList.handleAddClick);
  spksEl.addEventListener("keydown", speakerList.handleKeydown);
  spkAddBtn.addEventListener("click", speakerList.handleAddClick);
  viewpointResetBtn?.addEventListener("click", handleResetViewpoint);
  const handleChatStatusAction = (): void => pushSocket?.reconnectNow();
  chatStatusActionBtn.addEventListener("click", handleChatStatusAction);
  sessionResetBtn?.addEventListener("click", showSessionConfirm);
  sessionConfirmBtn?.addEventListener("click", handleSessionReset);
  sessionCancelBtn?.addEventListener("click", hideSessionConfirm);
  popOutBtn?.addEventListener("click", handlePopOut);
  messageBtn?.addEventListener("click", handleMessage);
  devtoolsBtn?.addEventListener("click", () => onOpenDevtools?.());
  closeBtn?.addEventListener("click", popover.close);
  // window variant is always visible, so open it immediately.
  if (isWindow) popover.open();

  function dispose(): void {
    disposed = true;
    endpoints.dispose();
    workflows.dispose();
    screen.dispose();
    reactions.dispose();
    agent.dispose();
    hintTooltip.dispose();
    sections.dispose();
    history?.dispose();
    scheduleCueList?.destroy();
    proactiveCueList?.destroy();
    unsubscribe();
    unsubscribeIdleThrottle();
    unsubscribeTts?.();
    unsubscribeGaze?.();
    unsubscribeClimb?.();
    unsubscribeFall?.();
    unsubscribeBubblePersist?.();
    unsubscribeMessageWindow?.();
    unsubscribeVoice();
    unsubscribeLipsync();
    unsubscribeVad();
    unsubscribeEndpoints();
    unsubscribePushState?.();
    unsubscribeFiller?.();
    unsubscribeSections?.();
    unsubscribeVrm();
    unsubscribeSpk();
    unsubscribeSession?.();
    unsubscribeDelegations?.();
    if (delegationsTimer !== null) clearInterval(delegationsTimer);
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
    fillerFirstTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerRepeatTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerLongWaitTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerTimeoutTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerUnreachableTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerToolTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
    disposeGainSlider();
    disposeVadSlider();
    tablistEl.removeEventListener("click", handleTabClick);
    tablistEl.removeEventListener("keydown", handleTabKeydown);
    railCollapseBtn.removeEventListener("click", handleRailCollapseClick);
    vrmsEl.removeEventListener("keydown", vrmList.handleKeydown);
    vrmAddBtn.removeEventListener("click", vrmList.handleAddClick);
    spksEl.removeEventListener("keydown", speakerList.handleKeydown);
    spkAddBtn.removeEventListener("click", speakerList.handleAddClick);
    viewpointResetBtn?.removeEventListener("click", handleResetViewpoint);
    chatStatusActionBtn.removeEventListener("click", handleChatStatusAction);
    sessionResetBtn?.removeEventListener("click", showSessionConfirm);
    sessionConfirmBtn?.removeEventListener("click", handleSessionReset);
    sessionCancelBtn?.removeEventListener("click", hideSessionConfirm);
    popOutBtn?.removeEventListener("click", handlePopOut);
    messageBtn?.removeEventListener("click", handleMessage);
    closeBtn?.removeEventListener("click", popover.close);
    el.remove();
    scrimEl.remove();
  }

  return { el, open: openPanel, close: popover.close, isOpen: popover.isOpen, dispose };
}
