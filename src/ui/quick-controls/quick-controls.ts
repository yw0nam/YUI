/**
 * Settings panel — fills the settings window: a rail of the character's pages (connection · voice ·
 * persona · body · history) then every character's pages (together · listening · permissions ·
 * proactive · motion · general) beside the page body.
 */

import type { createThemeSettings } from "../../settings/appearance/theme-settings";
import { createAppearanceSection } from "./sections/appearance/appearance-section";
import "./quick-controls.css";
import "./controls.css";
import type { AvatarOption } from "../../config/validators/avatar/types";
import type { Card, PersonaConfig } from "../../config/validators/persona/types";
import type { GuideKey } from "../../contract";
import type { ImportedCard } from "../../io/assets/card/card-import";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import type { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import type { createSessionDiagnosticsStore } from "../../io/chat/conversation/session-diagnostics";
import type { createSessionStore } from "../../io/chat/conversation/session-store";
import type { createSignalHistoryStore } from "../../io/chat/conversation/signal-history-store";
import type { DelegationItem } from "../../io/chat/push/push-frames";
import type { McpHost, McpHostManage } from "../../io/mcp-host/mcp-host";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import type { PickedVoiceImport } from "../../io/voice/voices/voice-import-flow";
import type { ScreenSourceProvider } from "../../io/window/capture/screen-source-provider";
import { createLogger } from "../../logger";
import type { BedSceneSettingsStore } from "../../settings/avatar/bed-scene-settings";
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
import type { createUserNameSettings } from "../../settings/identity/user-name-settings";
import type { MessageWindowSettingsStore } from "../../settings/panels/message-window-settings";
import type { SettingsPage } from "../../settings/panels/settings-pages";
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
import { t } from "../i18n";
import { createCharacterTab } from "./character/character-tab";
import { createConnectionTab, type PushSocketPanelPort } from "./connection/connection-tab";
import { DEFAULT_PAGE } from "./constants";
import { mountCueLists } from "./cue-lists/cue-lists";
import { createHintTooltip } from "./hint-tooltip";
import { createHistoryTab } from "./history/history-tab";
import { createPanelShell } from "./panel-shell";
import { createPresetStrip } from "./preset/preset-strip";
import { bindSettingsSearch } from "./search/settings-search";
import { createAgentSection } from "./sections/agent/agent-section";
import { createCardSection } from "./sections/card/card-section";
import { bindDevtoolsRow } from "./sections/devtools/devtools-row";
import { createFillerSection } from "./sections/filler/filler-section";
import { bindHelpSection } from "./sections/help/help-section";
import { createKeyRow } from "./sections/key-row/key-row";
import { bindTransportLinks } from "./sections/push-reason/push-reason";
import { createReactionsSection } from "./sections/reactions/reactions-section";
import { createReadingsSection } from "./sections/readings/readings-section";
import { createScreenSection } from "./sections/screen/screen-section";
import { createScreenshotSection } from "./sections/screenshot/screenshot-section";
import { createSessionSection } from "./sections/session/session-section";
import { createSpeakerList } from "./sections/speaker/speaker-list";
import { createUserNameSection } from "./sections/user-name/user-name-section";
import { createVoiceInputSection } from "./sections/voice-input/voice-input-section";
import { createWorkflowsSection } from "./sections/workflows/workflows-section";
import { createSwitchRows } from "./switch-row";
import { bindSwitchRows } from "./switches/switch-rows";
import { createTabRail } from "./tabs/tab-rail";
import { buildPanelHtml } from "./template";
import { createCharactersSection } from "./together/characters-section";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type ScheduleSettingsStore = ReturnType<typeof createScheduleSettings>;
type WorkflowSettingsStore = ReturnType<typeof createWorkflowSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type VadSettingsStore = ReturnType<typeof createVadSettings>;
type ThemeSettingsStore = ReturnType<typeof createThemeSettings>;
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
  /** Resolves the chat key the chat turn would send, per request (SecretProvider path). */
  getChatApiKey?: () => Promise<string | undefined>;
  /** Environment fetch for the model list read (selectFetch()), undefined → globalThis.fetch. */
  getFetch?: () => Promise<typeof globalThis.fetch | undefined>;
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
  transcript?: Pick<ChatHistoryStore, "startNewSession" | "sessions" | "subscribe">;
  /** Signal records. Feed the History tab beside the turns they ran in. */
  signalHistory?: Pick<SignalHistoryStore, "records" | "subscribe">;
  /** Thinking filler settings store. Gates the filler section and the card export's filler pools. */
  fillerSettings: FillerSettingsStore;
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
  /** Per-variant idle-motion on/off store. If absent, the idle-motion section won't render. */
  idleMotionSettings?: IdleMotionSettingsStore;
  /** The read-only `idle` catalog entry backing that section (undefined until configs load). */
  getIdlePool?: () => IdleVariantPool | undefined;
  /** Per-motion express-motion on/off store. If absent, the express-motion section won't render. */
  expressMotionSettings?: ExpressMotionSettingsStore;
  /** Agent-triggerable motion ids backing that section (empty until configs load). */
  getExpressMotions?: () => readonly string[];
  /** Launch bed scene on/off + wake timeout store. If absent, that section won't render. */
  bedSceneSettings?: BedSceneSettingsStore;
  /** The plugin host and its managing commands. If absent, the Plugins page won't render. */
  plugins?: { host: McpHost; manage: McpHostManage };
  /** Card file steps and the preset creator, wired by the app layer. */
  importCard: () => Promise<ImportedCard | null>;
  exportCard: (text: string, fileName: string) => Promise<"written" | "cancelled">;
  createPresetFromCard: (card: Card, thumbnailTempId?: string) => Promise<string>;
  removeCardThumbnail: (id: string) => Promise<void>;
  /** Opens the photo picker for a preset and returns its new thumbnail URL; absent outside Tauri. */
  pickPresetPhoto?: (presetId: string) => Promise<string | null>;
  /** Preset list and active preset. If absent, the preset strip and the tab scope lines won't render. */
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
  /** The preset strip picks the preset the window edits. */
  onEditTarget: (id: string) => void;
  showVoiceInput?: boolean;
}

/** A part of the panel the shell redraws on open, closes, and disposes. */
interface PanelSection {
  reflect?(): void;
  close?(): void;
  dispose?(): void;
}

interface QuickControls {
  el: HTMLElement;
  /** Shows the panel. `tab` lands on that tab instead of the one last left selected. */
  open(opts?: { tab?: SettingsPage }): void;
  /** The tab the panel shows now. */
  selectedTab(): SettingsPage;
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
  endpointsSettings,
  chatKeySettings,
  sttKeySettings,
  ttsKeySettings,
  getEndpointDefaults,
  getDefaultChatApi,
  getChatApiKey,
  getFetch,
  pushSocket,
  announceSessionReset,
  delegations,
  sessionDiagnostics,
  sessionStore,
  transcript,
  signalHistory,
  fillerSettings,
  readingsSettings,
  ttsSettings,
  oneVoiceSettings,
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
  idleMotionSettings,
  getIdlePool,
  expressMotionSettings,
  getExpressMotions,
  bedSceneSettings,
  plugins,
  importCard,
  exportCard,
  createPresetFromCard,
  removeCardThumbnail,
  pickPresetPhoto,
  presetRegistry,
  petWindows,
  relationsStore,
  relationsSwitch,
  unifiedChatSwitch,
  unifiedShown,
  boundId,
  onEditTarget,
  showVoiceInput = true,
}: QuickControlsOptions): QuickControls {
  // The context-occupancy readout renders when both stores are injected.
  const hasSession = !!sessionDiagnostics && !!sessionStore;
  const log = createLogger("quick-controls");

  const el = document.createElement("div");
  el.className = "yui-quick";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", t("panel.dialog_label"));

  const TOGGLE_SPECS = createSwitchRows({
    idleThrottleSettings,
    ttsSettings,
    oneVoiceSettings,
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
    unifiedChatSwitch,
    unifiedShown,
    relationsSwitch,
  });

  el.innerHTML = buildPanelHtml({
    hasSession,
    switchRows: TOGGLE_SPECS,
    showVoiceInput,
    showScreen: !!screenSettings && !!screenKnobSettings,
    showPresence: !!presenceSettings,
    showPacerGap: !!pacerGapSettings,
    showRateLimits: !!rateLimitSettings,
    showDevtools: !!onOpenDevtools,
    showHelp: !!onGuide,
    showHistory: !!transcript,
    showPlugins: !!plugins,
    showPreset: !!presetRegistry,
    showCharacters: !!presetRegistry && !!petWindows,
  });

  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
  const tablistEl = el.querySelector<HTMLDivElement>(".yui-tabs")!;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab"));

  // ── Connection page (URL fields · API key rows · TTS/Chat dropdowns · status line · resets) ──
  const connectionTab = createConnectionTab({
    endpointsSettings,
    chatKeySettings,
    ttsKeySettings,
    getEndpointDefaults,
    getDefaultChatApi,
    pushSocket,
    isOpen: () => shell.isOpen(),
    getChatApiKey,
    getFetch,
    log,
  });
  el.querySelector("#yui-panel-conn")!.append(connectionTab.el);

  // ── History tab (session accordion + start fresh) — only with a transcript store. ──
  const historyTab = transcript
    ? createHistoryTab({
        transcript,
        signalHistory,
        sessionDiagnostics,
        sessionStore,
        announceSessionReset,
        pushSocket,
        getChatApi: () => (isPushMode() ? "push" : undefined),
        agentSettings,
        getPersona,
        isOpen: () => shell.isOpen(),
        log,
      })
    : null;
  if (historyTab) el.querySelector("#yui-panel-hist .yui-tabpanel__title")!.after(historyTab.el);
  const workflows = createWorkflowsSection({ root: el, store: workflowSettings, log });
  const presetStrip = presetRegistry
    ? createPresetStrip({
        root: el,
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
      })
    : null;
  const characters =
    presetRegistry && petWindows
      ? createCharactersSection({ root: el, registry: presetRegistry, petWindows, boundId, log })
      : null;
  const hintTooltip = createHintTooltip({ root: el });

  // After dispose, prevent in-flight refresh from repainting/timering on destroyed DOM.
  let disposed = false;

  // ── Character tab — owns the Body and Motion rows; the shell mounts both stacks and relays open/close. ──
  const characterTab = createCharacterTab({
    rows: {
      vrms: true,
      gain: true,
      idleMotion: !!idleMotionSettings,
      expressMotion: !!expressMotionSettings,
      bedScene: !!bedSceneSettings,
      viewpoint: !!onResetViewpoint,
      relations: !!relationsStore && !!relationsSwitch && !!presetRegistry,
    },
    vrmSelection,
    swapVrm,
    importVrm,
    removeUserVrm,
    isOpen: () => shell.isOpen(),
    log,
    refreshTooltip: hintTooltip.refresh,
    onResetView: onResetViewpoint,
    gain: { lipsync, onPreview: onGainPreview, onPreviewEnd: onGainPreviewEnd },
    ...(idleMotionSettings
      ? { idleMotion: { settings: idleMotionSettings, getPool: () => getIdlePool?.() } }
      : {}),
    ...(expressMotionSettings
      ? {
          expressMotion: {
            settings: expressMotionSettings,
            getVocabulary: () => getExpressMotions?.() ?? [],
          },
        }
      : {}),
    ...(bedSceneSettings ? { bedScene: { settings: bedSceneSettings } } : {}),
    ...(relationsStore && relationsSwitch && presetRegistry
      ? {
          relations: {
            store: relationsStore,
            relationsSwitch,
            self: presetIdForWindow(),
            presets: () => presetRegistry.get().list,
          },
        }
      : {}),
  });
  el.querySelector("#yui-panel-body")!.append(characterTab.el);
  el.querySelector("#yui-panel-motion .yui-motion-switches")!.before(characterTab.motionEl);

  // ── Speaker section ──
  const speakerList = createSpeakerList({
    root: el,
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
    refreshTooltip: hintTooltip.refresh,
    isDisposed: () => disposed,
    isOpen: () => shell.isOpen(),
  });

  // ── shell (open/close lifecycle) ──
  const shell = createPanelShell({
    mount,
    root: el,
    closeWindow: onCloseWindow,
    onOpen: () => {
      for (const section of sections) section.reflect?.();
      // Opening on the Connection page counts as entering it — the model list read follows.
      if (tabRail.selected() === "conn") connectionTab.entered();
      // Server may have come up after the app — refetch its voice list (store subscription re-renders).
      refreshVoiceList?.();
      // Last, so the list the monitors fill is already redrawn.
      screenshot.loadMonitorsIfEnabled();
    },
    onClose: () => {
      for (const section of sections) section.close?.();
    },
  });

  // ── Switch rows (click binding · store following while open) ──
  const switchRows = bindSwitchRows(el, TOGGLE_SPECS, log, shell.isOpen);

  // ── Screen section (screen-watch threshold knobs · min-gap slider) ──
  const screen = createScreenSection({
    root: el,
    screenSettings,
    screenKnobSettings,
    getScreenDefaults,
    reflectSwitchRows: () => switchRows.reflect(),
    isOpen: shell.isOpen,
  });

  // ── Reactions section (agent port · presence · pacer gap · rate-limit caps) ──
  const reactions = createReactionsSection({
    boundId,
    root: el,
    agentNotifySettings,
    presenceSettings,
    pacerGapSettings,
    rateLimitSettings,
    getRateLimitDefaults,
    reflectSwitchRows: () => switchRows.reflect(),
    isOpen: shell.isOpen,
  });

  // ── Agent section (locale segment · reasoning-effort segment) ──
  const agent = createAgentSection({
    root: el,
    agentSettings,
    endpointsSettings,
    isPushMode,
    isOpen: shell.isOpen,
    log,
  });
  const appearance = createAppearanceSection({
    root: el,
    themeSettings,
    isOpen: shell.isOpen,
    log,
  });

  // ── Card section (send switch · card fields · greetings · import/export) ──
  const card = createCardSection({
    root: el,
    agentSettings,
    endpointsSettings,
    fillerSettings,
    registry: presetRegistry,
    getPersona,
    isPushMode,
    isOpen: shell.isOpen,
    importCard,
    exportCard,
    createPresetFromCard,
    log,
  });

  // ── Your name (General page) · the shared STT key (Listening page) ──
  const userName = createUserNameSection({
    root: el,
    userNameSettings,
    getPersona,
    isOpen: shell.isOpen,
  });
  const sttKeyRow = createKeyRow({
    root: el,
    idPrefix: "sttkey",
    store: sttKeySettings,
    isOpen: shell.isOpen,
    log,
  });

  // ── Thinking filler section (language segment · phrase-pool textareas) ──
  const filler = createFillerSection({
    root: el,
    fillerSettings,
    isOpen: shell.isOpen,
    reflectSwitchRows: () => switchRows.reflect(),
  });

  // ── Reading dictionary section (word=reading textarea · skipped-line message) ──
  const readings = createReadingsSection({ root: el, readingsSettings });

  // ── Voice input section (voice switch · silence threshold slider) ──
  const voiceInput = createVoiceInputSection({
    root: el,
    voiceStatus,
    vad,
    reflectSwitchRows: () => switchRows.reflect(),
    isOpen: shell.isOpen,
    log,
  });

  // ── Session section (context readout · delegated-work list and its minute refresh) ──
  const session = createSessionSection({
    root: el,
    sessionDiagnostics,
    pushSocket,
    isPushMode,
    delegations,
    isOpen: shell.isOpen,
  });

  // ── Screenshot section (attach switch · monitor list) ──
  const screenshot = createScreenshotSection({
    root: el,
    settings,
    sourceProvider,
    log,
    isOpen: shell.isOpen,
  });

  // Effective chat protocol: the user's override, else the bundled default.
  function isPushMode(): boolean {
    return effectiveChatApi(endpointsSettings.get().chat_api, getDefaultChatApi?.()) === "push";
  }

  // ── Tab rail (selection, ARIA, keyboard) ──
  const tabRail = createTabRail({
    rail: tablistEl,
    buttons: tabButtons,
    panels: Array.from(el.querySelectorAll<HTMLElement>(".yui-tabpanel")),
    initial: DEFAULT_PAGE,
    onSelect: (id) => {
      if (id === "conn") connectionTab.entered();
    },
  });

  const unbindTransportLinks = bindTransportLinks(el, (id) => tabRail.select(id));
  const unbindSearch = bindSettingsSearch(el);

  function openPanel(opts?: { tab?: SettingsPage }): void {
    const tab = opts?.tab;
    if (tab && tabRail.select(tab)) {
      shell.open();
      // open() lands focus on the first control; move it to the tab the caller asked for.
      tabRail.select(tab, { focusVisible: false });
    } else {
      shell.open();
    }
  }

  function selectedTab(): SettingsPage {
    return tabRail.selected() as SettingsPage;
  }

  // Cue-list components — both on the Proactive page: proactive in .yui-loop-cue-section, schedule in .yui-cue-sections.
  const loopCueMountEl = el.querySelector<HTMLDivElement>(".yui-loop-cue-section")!;

  const cueLists = mountCueLists({
    scheduleMount: cueSectionsMountEl,
    proactiveMount: loopCueMountEl,
    scheduleSettings,
    proactiveSettings,
  });

  const unbindDevtools = onOpenDevtools ? bindDevtoolsRow(el, onOpenDevtools) : undefined;
  const unbindHelp = onGuide ? bindHelpSection(el, onGuide) : undefined;
  // Every section the panel redraws on open, closes and disposes, in redraw order.
  const parts: (PanelSection | null | undefined)[] = [
    screenshot,
    switchRows,
    reactions,
    screen,
    voiceInput,
    agent,
    card,
    userName,
    { reflect: sttKeyRow.reflect, close: sttKeyRow.commitIfDirty, dispose: sttKeyRow.dispose },
    filler,
    { reflect: agent.reflectLanguage },
    appearance,
    {
      reflect: connectionTab.refresh,
      close: () => {
        connectionTab.commit();
        connectionTab.close();
      },
      dispose: connectionTab.dispose,
    },
    session,
    historyTab && { reflect: historyTab.refresh, dispose: historyTab.dispose },
    characters && { reflect: characters.refresh, dispose: characters.dispose },
    { reflect: characterTab.refresh, close: characterTab.close, dispose: characterTab.dispose },
    { reflect: speakerList.render, close: speakerList.stopAudition, dispose: speakerList.dispose },
    { close: hintTooltip.hide, dispose: hintTooltip.dispose },
    presetStrip,
    readings,
    workflows,
    { dispose: cueLists.destroy },
    unbindDevtools && { dispose: unbindDevtools },
    { dispose: unbindHelp },
    { dispose: unbindTransportLinks },
    { dispose: unbindSearch },
    tabRail,
  ];
  const sections = parts.filter((section): section is PanelSection => !!section);

  // The panel fills its window, so it opens at once.
  shell.open();

  function dispose(): void {
    disposed = true;
    for (const section of sections) section.dispose?.();
    shell.dispose();
    el.remove();
  }

  return {
    el,
    open: openPanel,
    selectedTab,
    dispose,
  };
}
