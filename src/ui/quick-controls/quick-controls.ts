/**
 * Settings panel — fills the settings window: a rail of the character's pages (connection · voice ·
 * persona · body · history) then every character's pages (together · listening · permissions ·
 * proactive · motion · general) beside the page body.
 */

import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { ActiveHoursSettingsStore } from "../../settings/active-hours/active-hours-settings";
import type { BasePaceSettingsStore } from "../../settings/active-hours/base-pace-settings";
import type { createTextSizeSettings } from "../../settings/appearance/text-size-settings";
import type { createThemeSettings } from "../../settings/appearance/theme-settings";
import type { ThreadReactionThresholdsSettingsStore } from "../../settings/threads/thread-reaction-thresholds-settings";
import type { ThreadTurnsSettingsStore } from "../../settings/threads/thread-turns-settings";
import "./quick-controls.css";
import "./controls.css";
import type { AvatarOption } from "../../config/validators/avatar/types";
import type { PersonaConfig } from "../../config/validators/persona/types";
import type { EndpointsConfig, GuideKey } from "../../contract";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import type { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import type { createSessionDiagnosticsStore } from "../../io/chat/conversation/session-diagnostics";
import type { createSessionStore } from "../../io/chat/conversation/session-store";
import type { createSignalHistoryStore } from "../../io/chat/conversation/signal-history-store";
import type { ServerCheck } from "../../io/chat/models/server-check";
import type { DelegationItem } from "../../io/chat/push/push-frames";
import type { McpHost, McpHostManage } from "../../io/mcp-host/mcp-host";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import type { PickedVoiceImport } from "../../io/voice/voices/voice-import-flow";
import type { ScreenSourceProvider } from "../../io/window/capture/screen-source-provider";
import type { SubscribeFileDrop } from "../../io/window/file-drop/file-drop";
import { createLogger } from "../../logger";
import type { ExpressMotionSettingsStore } from "../../settings/avatar/express-motion-settings";
import type {
  IdleMotionSettingsStore,
  IdleVariantPool,
} from "../../settings/avatar/idle-motion-settings";
import type { createLipsyncSettings } from "../../settings/avatar/lipsync-settings";
import type { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type { createAgentSettings } from "../../settings/backend/agent-settings";
import type {
  ApiKeySettingsStore,
  ChatKeySettingsStore,
} from "../../settings/backend/api-key-settings";
import {
  type createEndpointsSettings,
  type EndpointOverrides,
  effectiveChatApi,
} from "../../settings/backend/endpoints-settings";
import type {
  GuardrailsSettingsStore,
  RateLimitDefaults,
} from "../../settings/backend/guardrails-settings";
import type { createWorkflowSettings } from "../../settings/backend/workflow-settings";
import type {
  ScreenKnobSettingsStore,
  ScreenOverrides,
} from "../../settings/capture/screen-settings";
import type { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import type { createProactiveSettings } from "../../settings/cues/proactive-settings";
import type { createScheduleSettings } from "../../settings/cues/schedule-settings";
import type { createUserNameSettings } from "../../settings/identity/user-name-settings";
import type { MessageWindowSettingsStore } from "../../settings/panels/message-window-settings";
import {
  APP_PAGES,
  CHARACTER_PAGES,
  type PageRequest,
  type SettingsPage,
} from "../../settings/panels/settings-pages";
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../../settings/persisted-store";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import type { PetWindows } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { RelationsStore } from "../../settings/relations/relations-store";
import type { UnifiedShown } from "../../settings/unified/unified-shown";
import type { createFillerSettings } from "../../settings/voice/filler-settings";
import type { createReadingsSettings } from "../../settings/voice/readings-settings";
import type { createVadSettings } from "../../settings/voice/vad-settings";
import type { VoiceInputStatus } from "../chips/voice-input-status";
import type { TabsHandle } from "../controls/tabs";
import type { TooltipHostHandle } from "../controls/tooltip";
import { t } from "../i18n";
import { createBodyPage } from "./body/body-page";
import { createConnectionPage, type PushSocketPanelPort } from "./connection/connection-page";
import { initialPageOf } from "./constants";
import { createDelegationFeed } from "./delegations/delegation-feed";
import { createGeneralPage } from "./general/general-page";
import { createHistoryPage } from "./history/history-page";
import { createListeningPage } from "./listening/listening-page";
import { createMotionPage } from "./motion/motion-page";
import { createPanelShell } from "./panel-shell";
import { createPermsPage } from "./perms/perms-page";
import type { CardIoPorts } from "./persona/card/card-io";
import { createPersonaPage } from "./persona/persona-page";
import { createPluginsPage } from "./plugins/plugins-page";
import { createEditedPreset } from "./preset/edited-preset";
import type { PresetHeaderHandle } from "./preset/preset-header";
import { createProactivePage } from "./proactive/proactive-page";
import { bindSettingsSearch } from "./search/settings-search";
import { bindHelpSection } from "./sections/help/help-section";
import { bindTransportLinks } from "./sections/push-reason/push-reason";
import { SettingsPanel } from "./settings-panel";
import { createSwitchRows } from "./switch-row";
import { createTogetherPage } from "./together/together-page";
import { createVoicePage } from "./voice/voice-page";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type ScheduleSettingsStore = ReturnType<typeof createScheduleSettings>;
type WorkflowSettingsStore = ReturnType<typeof createWorkflowSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type VadSettingsStore = ReturnType<typeof createVadSettings>;
type ThemeSettingsStore = ReturnType<typeof createThemeSettings>;
type TextSizeSettingsStore = ReturnType<typeof createTextSizeSettings>;
type UserNameSettingsStore = ReturnType<typeof createUserNameSettings>;
type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type FillerSettingsStore = ReturnType<typeof createFillerSettings>;
type ReadingsSettingsStore = ReturnType<typeof createReadingsSettings>;
type VrmSelectionStore = ReturnType<typeof createVrmSelection>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;
type SessionDiagnosticsStore = ReturnType<typeof createSessionDiagnosticsStore>;
type SessionStore = ReturnType<typeof createSessionStore>;
type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;
type SignalHistoryStore = ReturnType<typeof createSignalHistoryStore>;

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
  /** STT silence threshold (ms) single-value store. The Listening page slider drives it. */
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
  /** Import pick step: stages the copy in Rust, returns its staging id + a naming-row seed (null on cancel). */
  pickVoiceImport: () => Promise<PickedVoiceImport | null>;
  /** Import commit step: uploads the staged copy under the typed name → addUserOption + select. Inline error on reject. */
  commitVoiceImport: (stagedId: string, name: string) => Promise<void>;
  /** Delete imported voice's app-data file (idempotent). Called separately from store removal. */
  removeVoice: (id: string) => Promise<void>;
  /** Whether the TTS provider takes imported voices — gates import, delete and re-upload. */
  canManageVoices: () => boolean;
  /** Whether the TTS provider takes a clip again under the voice's own id — gates re-upload. */
  canReuploadVoices: () => boolean;
  /** On shows the speaker list's paste-id field. */
  canPasteVoiceId: () => boolean;
  /** Refetches the TTS server's voice list on panel open (the server may come up after the app). Fire-and-forget. */
  refreshVoiceList?: () => void;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  /** Reset the camera viewpoint (orbit angles) to head-on. Renders the section when set. */
  onResetViewpoint?: () => void;
  onOpenDevtools?: () => void;
  /** Asks the character to explain from a bundled guide. Renders the Help section when set. */
  onGuide?: (guide: GuideKey, text: string) => void;
  /** Escape closes the OS window through it (host injected). Without it, Escape is a no-op. */
  onCloseWindow?: () => void;
  /** The bundled default cards and `{{user}}` fallback words (undefined if not loaded). */
  getPersona?: () => PersonaConfig | undefined;
  /** Device-wide "Your name" store for the General page. */
  userNameSettings: UserNameSettingsStore;
  /** Device-wide theme store for the General tab's Appearance row. */
  themeSettings: ThemeSettingsStore;
  /** Device-wide text size store for the General tab's Text size row. */
  textSizeSettings: TextSizeSettingsStore;
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
  /** The Fish voice per app language, for Quick start's voice step (undefined if not loaded). */
  getDefaultVoices?: () => NonNullable<EndpointsConfig["tts_default_voices"]> | undefined;
  /** Resolves the chat key the chat turn would send, per request (SecretProvider path). */
  getChatApiKey?: () => Promise<string | undefined>;
  /** Environment fetch for the model list read (selectFetch()), undefined → globalThis.fetch. */
  getFetch?: () => Promise<typeof globalThis.fetch | undefined>;
  /** Asks the STT server whether it answers, for the Connection page's STT line; undefined hides the line. */
  checkSttServer?: () => Promise<ServerCheck | null>;
  /** Asks the TTS server whether it answers, for the Connection page's TTS line; undefined hides the line. */
  checkTtsServer?: () => Promise<ServerCheck | null>;
  /** The window's effective endpoints, backing the Connection page's STT and TTS lines. */
  getEndpoints?: () => EndpointsConfig | null;
  /** Push transport — the chat section shows its state, and "Start fresh" resets the conversation on it. */
  pushSocket?: PushSocketPanelPort;
  /** "Start fresh" calls it after the transcript boundary is written. */
  announceSessionReset?: () => void;
  /** Delegated-work list for the session section. The pet window publishes it. */
  delegations?: DelegationsPanelPort;
  /** Session diagnostics (context usage · last compression), read by the occupancy readout. */
  sessionDiagnostics?: SessionDiagnosticsStore;
  /** Current session id pointer. "Start fresh" clears it along with diagnostics. */
  sessionStore?: SessionStore;
  /** Unified conversation transcript. Feeds the History tab; "Start fresh" closes the running session in it. */
  transcript?: Pick<ChatHistoryStore, "startNewSession" | "current" | "subscribe">;
  /** Signal records. Feed the History tab beside the turns they ran in. */
  signalHistory?: Pick<SignalHistoryStore, "current" | "subscribe">;
  /** Thinking filler settings store. Gates the filler section and the card export's filler pools. */
  fillerSettings: FillerSettingsStore;
  /** Per-character active hours store. With it, the Persona page renders the Active hours editor. */
  activeHoursSettings?: ActiveHoursSettingsStore;
  /** Device-wide base pace store. With it, the Proactive page renders How often she speaks up. */
  basePaceSettings?: BasePaceSettingsStore;
  /** Reading dictionary store. */
  readingsSettings: ReadingsSettingsStore;
  /** TTS speech output on/off store. */
  ttsSettings?: FlagSettingsStore;
  /** One-voice-at-a-time store. If absent, that toggle row won't render. */
  oneVoiceSettings?: FlagSettingsStore;
  /** Cursor gaze (eye contact) on/off store. If absent, that toggle row won't render. */
  gazeSettings?: FlagSettingsStore;
  /** Ambient window-climbing on/off store. If absent, that toggle row won't render. */
  climbSettings?: FlagSettingsStore;
  /** Falling on/off store. If absent, that toggle row won't render. */
  fallSettings?: FlagSettingsStore;
  /** Agent notification on/off store. If absent, that toggle row won't render. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** Thread turns level store. With agentNotifySettings, renders the Thread turns row under Threads. */
  threadTurnsSettings?: ThreadTurnsSettingsStore;
  /** Thread reactions on/off store. If absent, that toggle row won't render. */
  threadReactionsSettings?: FlagSettingsStore;
  /** Reaction thresholds store. With threadReactionsSettings, renders the Reaction thresholds rows under Threads. */
  threadReactionThresholdsSettings?: ThreadReactionThresholdsSettingsStore;
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
  getRateLimitDefaults?: () => RateLimitDefaults | undefined;
  /** Screen-watch on/off store. If absent, the screen-watch section won't render. */
  screenSettings?: FlagSettingsStore;
  /** Screen-watch threshold overrides. If absent, the knob group won't be editable. */
  screenKnobSettings?: ScreenKnobSettingsStore;
  /** Bundled config thresholds shown when a knob carries no override (undefined if not loaded). */
  getScreenDefaults?: () => ScreenOverrides | undefined;
  /** Per-variant idle-motion on/off store. If absent, the idle-motion section won't render. */
  idleMotionSettings?: IdleMotionSettingsStore;
  /** The read-only `idle` catalog entry backing that section (undefined until configs load). */
  getIdlePool?: () => IdleVariantPool | undefined;
  /** Per-motion express-motion on/off store. If absent, the express-motion section won't render. */
  expressMotionSettings?: ExpressMotionSettingsStore;
  /** Agent-triggerable motion ids backing that section (empty until configs load). */
  getExpressMotions?: () => readonly string[];
  /** The MCP host and its managing commands. If absent, the Plugins page won't render. */
  plugins?: { host: McpHost; manage: McpHostManage };
  /** Card file steps, wired by the app layer. */
  importPreset: CardIoPorts["importPreset"];
  importDroppedPreset: CardIoPorts["importDroppedPreset"];
  importBusy: CardIoPorts["importBusy"];
  exportPresetFile: CardIoPorts["exportPresetFile"];
  exportCardPng: CardIoPorts["exportCardPng"];
  inspectPresetVrm: CardIoPorts["inspectPresetVrm"];
  removeCardThumbnail: CardIoPorts["removeCardThumbnail"];
  /** Opens the photo picker for a preset and returns its new thumbnail URL; absent outside Tauri. */
  pickPresetPhoto?: CardIoPorts["pickPresetPhoto"];
  /** This window's file drag events; absent outside Tauri, and then no drop cover. */
  subscribeFileDrop?: SubscribeFileDrop;
  /** Preset list and active preset. If absent, the preset header and the tab scope lines won't render. */
  presetRegistry?: PresetRegistry;
  petWindows?: PetWindows;
  /** This window's preset's relations, shown under the preset row. */
  relationsStore?: RelationsStore;
  /** The Relations switch: the Relations section's toggle and the relation line's gate. */
  relationsSwitch: FlagSettingsStore;
  /** The Unified chat switch: a Together-page row; absent where the window cannot be opened. */
  unifiedChatSwitch?: FlagSettingsStore;
  /** Whether the unified chat window shows; the message window row is locked off meanwhile. */
  unifiedShown?: UnifiedShown;
  boundId?: string | null;
  /** The preset header picks the preset the window edits. */
  onEditTarget: (id: string) => void;
  showVoiceInput?: boolean;
  /** Chat was unconfigured at window open: the panel opens on Connection, Quick start. */
  openOnQuickStart?: boolean;
  /** Quick start confirmed its key. */
  onFirstConversationConnected?: () => void;
  /** Quick start's replay button: the pet window replays the first conversation. */
  onReplayFirstConversation?: () => void;
}

interface QuickControls {
  el: HTMLElement;
  /** Shows the panel. The request's page lands instead of the one last left selected, and its focus focuses that field there. */
  open(request?: PageRequest): void;
  /** The tab the panel shows now. */
  selectedTab(): SettingsPage;
  /** The window came back to the front. */
  windowFocused(): void;
  dispose(): void;
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
  removeVoice,
  canManageVoices,
  canReuploadVoices,
  canPasteVoiceId,
  refreshVoiceList,
  onGainPreview,
  onGainPreviewEnd,
  onResetViewpoint,
  onOpenDevtools,
  onGuide,
  onCloseWindow,
  getPersona,
  userNameSettings,
  themeSettings,
  textSizeSettings,
  endpointsSettings,
  chatKeySettings,
  sttKeySettings,
  ttsKeySettings,
  getEndpointDefaults,
  getDefaultChatApi,
  getDefaultVoices,
  getChatApiKey,
  getFetch,
  checkSttServer,
  checkTtsServer,
  getEndpoints,
  pushSocket,
  announceSessionReset,
  delegations,
  sessionDiagnostics,
  sessionStore,
  transcript,
  signalHistory,
  fillerSettings,
  activeHoursSettings,
  basePaceSettings,
  readingsSettings,
  ttsSettings,
  oneVoiceSettings,
  gazeSettings,
  climbSettings,
  fallSettings,
  agentNotifySettings,
  threadTurnsSettings,
  threadReactionsSettings,
  threadReactionThresholdsSettings,
  bubblePersistSettings,
  messageWindowSettings,
  presenceSettings,
  pacerGapSettings,
  rateLimitSettings,
  getRateLimitDefaults,
  screenSettings,
  screenKnobSettings,
  getScreenDefaults,
  idleMotionSettings,
  getIdlePool,
  expressMotionSettings,
  getExpressMotions,
  plugins,
  importPreset,
  importDroppedPreset,
  importBusy,
  exportPresetFile,
  exportCardPng,
  inspectPresetVrm,
  removeCardThumbnail,
  pickPresetPhoto,
  subscribeFileDrop,
  presetRegistry,
  petWindows,
  relationsStore,
  relationsSwitch,
  unifiedChatSwitch,
  unifiedShown,
  boundId,
  onEditTarget,
  showVoiceInput = true,
  openOnQuickStart = false,
  onFirstConversationConnected,
  onReplayFirstConversation,
}: QuickControlsOptions): QuickControls {
  const log = createLogger("quick-controls");

  const el = document.createElement("div");
  el.className = "yui-quick";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", t("panel.dialog_label"));

  const rows = createSwitchRows({
    idleThrottleSettings,
    ttsSettings,
    oneVoiceSettings,
    gazeSettings,
    climbSettings,
    fallSettings,
    agentNotifySettings,
    fillerSettings,
    bubblePersistSettings,
    messageWindowSettings,
    screenSettings,
    screenKnobSettings,
    unifiedChatSwitch,
    unifiedShown,
    relationsSwitch,
    threadReactionsSettings,
  });

  // Attached before the panel renders: Base UI registers a slider's thumb only while it is connected.
  mount.appendChild(el);

  const tabs: { current: TabsHandle | null } = { current: null };
  const tooltip: { current: TooltipHostHandle | null } = { current: null };
  const presetHeader: { current: PresetHeaderHandle | null } = { current: null };
  const dropHost: { current: HTMLDivElement | null } = { current: null };
  // The shell exists by the time a page asks: only after the panel renders.
  const isOpen = (): boolean => shell.isOpen();

  // ── Proactive page (how often she speaks up · her day · the sources · Advanced) ──
  const proactivePage = createProactivePage({
    rows: rows.filter((row) => row.tab === "react"),
    basePaceSettings,
    activeHoursSettings,
    agentSettings,
    getPersona,
    scheduleSettings,
    proactiveSettings,
    // Runs on a click, after the tab rail exists.
    openPersona: () => tabs.current?.select("persona"),
    pacerGapSettings,
    presenceSettings,
    rateLimitSettings,
    getRateLimitDefaults,
    screenKnobSettings,
    getScreenDefaults,
    agentNotifySettings,
    threadTurnsSettings,
    threadReactionThresholdsSettings,
    boundId,
    workflowSettings,
    log,
  });

  // ── Connection page — Quick start (data use · daily limit · key confirmation) or Detailed settings ──
  const connectionPage = createConnectionPage({
    initial: openOnQuickStart ? "quick" : "detail",
    quick: {
      endpointsSettings,
      getEndpointDefaults,
      chatKeySettings,
      proactiveSettings,
      scheduleSettings,
      getFetch: async () => getFetch?.(),
      onConnected: () => onFirstConversationConnected?.(),
      showHelp: !!onGuide,
      ttsKeySettings,
      ttsSettings,
      speakerSelection,
      getDefaultVoices,
      onReplay: onReplayFirstConversation,
    },
    detail: {
      endpointsSettings,
      chatKeySettings,
      ttsKeySettings,
      sttKeySettings,
      checkSttServer,
      checkTtsServer,
      getEndpoints,
      getEndpointDefaults,
      getDefaultChatApi,
      pushSocket,
      agentSettings,
      isOpen,
      getChatApiKey,
      getFetch,
      log,
    },
  });

  // ── History page (session accordion · start fresh · Session section) — only with a transcript store. ──
  // The delegated list's sync lives with the panel, whether or not the page is there.
  const delegationFeed = createDelegationFeed(delegations);
  const historyPage = transcript
    ? createHistoryPage({
        transcript,
        signalHistory,
        sessionDiagnostics,
        sessionStore,
        announceSessionReset,
        pushSocket,
        isPushMode,
        delegations: delegationFeed,
        agentSettings,
        getPersona,
        isOpen,
        log,
      })
    : null;

  // ── Body page (VRM list · relations rows · view reset) ──
  const bodyPage = createBodyPage({
    vrmSelection,
    swapVrm,
    importVrm,
    removeUserVrm,
    isOpen,
    log,
    onResetView: onResetViewpoint,
    relations:
      relationsStore && relationsSwitch && presetRegistry
        ? {
            store: relationsStore,
            relationsSwitch,
            self: presetIdForWindow(),
            presets: () => presetRegistry.get().list,
          }
        : undefined,
  });

  // ── Motion page (mouth gain · idle and express motions · motion switch rows) ──
  const motionPage = createMotionPage({
    rows: rows.filter((row) => row.tab === "motion"),
    lipsync,
    onPreview: onGainPreview,
    onPreviewEnd: onGainPreviewEnd,
    idleMotion: idleMotionSettings && {
      settings: idleMotionSettings,
      getPool: () => getIdlePool?.(),
    },
    expressMotion: expressMotionSettings && {
      settings: expressMotionSettings,
      getVocabulary: () => getExpressMotions?.() ?? [],
    },
    isOpen,
    log,
  });

  // ── Voice page (switch rows · speaker list · thinking filler) ──
  const voicePage = createVoicePage({
    rows: rows.filter((row) => row.tab === "voice"),
    fillerSettings,
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    pickVoiceImport,
    commitVoiceImport,
    removeVoice,
    canManageVoices,
    canReuploadVoices,
    canPasteVoiceId,
    log,
    isOpen,
  });

  // ── Persona page (active hours above the card · the card fields · its file actions) ──
  const persona = createPersonaPage({
    dropHost,
    activeHoursSettings,
    agentSettings,
    endpointsSettings,
    fillerSettings,
    registry: presetRegistry,
    getPersona,
    isPushMode,
    isOpen,
    vrmSelection,
    speakerSelection,
    importPreset,
    importDroppedPreset,
    importBusy,
    exportPresetFile,
    exportCardPng,
    inspectPresetVrm,
    subscribeFileDrop,
    log,
  });

  // ── General page (language · appearance · text size · your name · Help · Developer Tools) ──
  const generalPage = createGeneralPage({
    themeSettings,
    textSizeSettings,
    userNameSettings,
    getPersona,
    onGuide,
    onOpenDevtools,
    log,
  });

  // ── Listening page (voice switch · STT key · silence threshold · barge-in · bubble · readings) ──
  const listeningPage = createListeningPage({
    showVoiceInput,
    voiceStatus,
    vad,
    sttKeySettings,
    readingsSettings,
    bubblePersistSettings,
    log,
  });

  // ── Together page (switch rows · chain cap · characters on the desktop) ──
  const togetherPage = createTogetherPage({
    rows: rows.filter((row) => row.tab === "together"),
    rateLimitSettings,
    getRateLimitDefaults,
    registry: presetRegistry,
    petWindows,
    boundId,
    log,
  });

  // ── Permissions page (attach switch · monitor list · screen requests) ──
  const permsPage = createPermsPage({ settings, sourceProvider, log, isOpen });

  // ── Plugins page (installed plugins · catalog · consent) ──
  const pluginsPage = plugins ? createPluginsPage({ ...plugins, log }) : undefined;

  // Effective chat protocol: the user's override, else the bundled default.
  function isPushMode(): boolean {
    return effectiveChatApi(endpointsSettings.get().chat_api, getDefaultChatApi?.()) === "push";
  }

  // ── The panel's one root: preset header · rail · every page in its panel · the tooltip ──
  const root = createRoot(el);
  flushSync(() =>
    root.render(
      createElement(SettingsPanel, {
        pages: [...CHARACTER_PAGES, ...APP_PAGES].filter(
          (id) => (id !== "hist" || !!historyPage) && (id !== "plugins" || !!pluginsPage),
        ),
        views: {
          conn: connectionPage.view,
          voice: voicePage.view,
          persona: persona.view,
          body: bodyPage.view,
          hist: historyPage?.view,
          together: togetherPage.view,
          listening: listeningPage.view,
          perms: permsPage.view,
          plugins: pluginsPage?.view,
          react: proactivePage.view,
          motion: motionPage.view,
          general: generalPage.view,
        },
        initial: initialPageOf(openOnQuickStart),
        preset: presetRegistry && {
          // The window reloads into the picked preset; until then it keeps showing this one.
          edited: createEditedPreset(presetRegistry, presetIdForWindow(), (state) =>
            onEditTarget(boundId ?? state.active),
          ),
          registry: presetRegistry,
          log,
          petWindows,
          boundId,
          onEditTarget,
          agentNotifySettings,
          relationsStore,
          relationsSwitch,
          removeCardThumbnail,
          pickPhoto: pickPresetPhoto,
          getDefaultChatApi,
          handle: presetHeader,
        },
        connQuickShown: connectionPage.quickShown,
        tabs,
        onSelect: (id) => {
          if (id === "conn") connectionPage.entered();
          if (id === "plugins") pluginsPage?.entered();
        },
        tooltip,
        dropHost,
      }),
    ),
  );
  const rail = tabs.current!;

  const unbindTransportLinks = bindTransportLinks(el, () => {
    rail.select("conn");
    connectionPage.focusChatType();
  });
  const unbindSearch = bindSettingsSearch(el);
  // Quick start's Help rows are the delegated ones; the General page handles its own.
  const unbindHelp = onGuide
    ? bindHelpSection(el.querySelector<HTMLElement>("#yui-panel-conn")!, onGuide)
    : undefined;

  // ── shell (open/close lifecycle) ──
  const shell = createPanelShell({
    root: el,
    closeWindow: onCloseWindow,
    onOpen: () => {
      // Each page's own redraw, one after another.
      proactivePage.refresh();
      persona.reflect();
      connectionPage.refresh();
      delegationFeed.sync();
      historyPage?.refresh();
      togetherPage.reflect();
      bodyPage.refresh();
      motionPage.refresh();
      voicePage.refresh();
      // Opening on the Connection page counts as entering it — the model list read follows.
      if (rail.selected() === "conn") connectionPage.entered();
      if (rail.selected() === "plugins") pluginsPage?.entered();
      // Server may have come up after the app — refetch its voice list (store subscription re-renders).
      refreshVoiceList?.();
      // Last, so the list the monitors fill is already redrawn.
      permsPage.loadMonitorsIfEnabled();
    },
    onClose: () => {
      listeningPage.close();
      connectionPage.commit();
      connectionPage.close();
      motionPage.close();
      voicePage.close();
      tooltip.current?.close();
      presetHeader.current?.close();
    },
  });

  function openPanel(request?: PageRequest): void {
    const tab = request?.page;
    const known = !!tab && rail.select(tab);
    shell.open();
    // open() lands focus on the first control; move it to the tab the caller asked for.
    if (known) rail.focus(tab, { focusVisible: false });
    if (request?.focus === "chat_key") connectionPage.focusKey();
  }

  function selectedTab(): SettingsPage {
    return rail.selected() as SettingsPage;
  }

  // The panel fills its window, so it opens at once.
  shell.open();

  // A plain sequence: the first cleanup that throws stops the rest, and the panel stays mounted.
  function dispose(): void {
    // The typed keys and endpoints land first: the locale remount and the window's teardown rely on it.
    listeningPage.close();
    connectionPage.commit();
    delegationFeed.dispose();
    unbindHelp?.();
    unbindTransportLinks();
    unbindSearch();
    root.unmount();
    voicePage.close();
    shell.dispose();
    el.remove();
  }

  return {
    el,
    open: openPanel,
    selectedTab,
    windowFocused: connectionPage.windowFocused,
    dispose,
  };
}
