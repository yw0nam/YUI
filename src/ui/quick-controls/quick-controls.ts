/**
 * Quick-controls panel — settings panel summoned by right-click.
 * Comprises a draggable header (popover variant only; the window variant uses the native titlebar) + a rail of the
 * character's pages (connection · voice · persona · body · history) then every character's pages (together ·
 * listening · permissions · proactive · motion · general) + the page body.
 * variant: "popover" (default, docked in pet window + draggable) | "window" (separate OS window, full fill).
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
import type { ClampedIntSettingsStore, FlagSettingsStore } from "../../settings/persisted-store";
import { presetIdForWindow } from "../../settings/preset/active-preset";
import type { PetWindows } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import type { RelationsStore } from "../../settings/relations/relations-store";
import type { createFillerSettings } from "../../settings/voice/filler-settings";
import type { createReadingsSettings } from "../../settings/voice/readings-settings";
import type { createVadSettings } from "../../settings/voice/vad-settings";
import type { VoiceInputStatus } from "../chips/voice-input-status";
import { t } from "../i18n";
import { createCharacterTab } from "./character/character-tab";
import { createConnectionTab, type PushSocketPanelPort } from "./connection/connection-tab";
import { DEFAULT_PAGE, type QuickControlsTab } from "./constants";
import { mountCueLists } from "./cue-lists/cue-lists";
import { createHeaderButtons } from "./header/header-buttons";
import { createHintTooltip } from "./hint-tooltip";
import { createHistoryTab } from "./history/history-tab";
import { createPopover } from "./popover";
import { createPresetStrip } from "./preset/preset-strip";
import { bindSettingsSearch } from "./search/settings-search";
import { createAgentSection, effortSectionHtml } from "./sections/agent/agent-section";
import { createBrowserSection } from "./sections/browser/browser-section";
import { createCardSection } from "./sections/card/card-section";
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
  onPopOut?: () => void;
  /** Opens the text input. Renders the header button when set. */
  onMessage?: () => void;
  onOpenDevtools?: () => void;
  /** Asks the character to explain from a bundled guide. Renders the Help section when set. */
  onGuide?: (guide: GuideKey, text: string) => void;
  variant?: "popover" | "window";
  /** In window variant, path for Escape to close OS window (host injected). Without it, Escape is no-op. */
  onCloseWindow?: () => void;
  /** Popover variant: the on-screen height of the pet window, re-read before each open; the panel stays inside it. */
  visibleViewport?: { get(): number; refresh(): Promise<void> };
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
  /** Stops the in-flight turn the way the stop button does, before the reset frame goes out. */
  stopTurn?: () => void;
  /** "Start fresh" calls it after the transcript boundary is written. */
  announceSessionReset?: () => void;
  /** Delegated-work list for the session section (window variant). The pet window publishes it. */
  delegations?: DelegationsPanelPort;
  /** Session diagnostics (context usage · last compression). The occupancy readout renders in the window variant only. */
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
  /** Browser-use on/off store. If absent, that section won't render. */
  browserSettings?: FlagSettingsStore;
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
  boundId?: string | null;
  /** Set in the settings window: the preset strip picks the preset the window edits. */
  onEditTarget?: (id: string) => void;
  showVoiceInput?: boolean;
}

interface QuickControls {
  el: HTMLElement;
  /** Summon the panel. `tab` lands on that tab instead of the one last left selected. */
  open(anchor?: { x: number; y: number }, opts?: { tab?: QuickControlsTab }): void;
  /** The tab the panel shows now. */
  selectedTab(): QuickControlsTab;
  close(): void;
  isOpen(): boolean;
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
  onPopOut,
  onMessage,
  onOpenDevtools,
  onGuide,
  variant = "popover",
  onCloseWindow,
  visibleViewport,
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
  stopTurn,
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
  browserSettings,
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
  boundId,
  onEditTarget,
  showVoiceInput = true,
}: QuickControlsOptions): QuickControls {
  const isWindow = variant === "window";
  // Context-occupancy readout renders only in the settings window, when both stores are injected.
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
    relationsSwitch,
  });

  el.innerHTML = buildPanelHtml({
    isWindow,
    hasSession,
    switchRows: TOGGLE_SPECS,
    showPopOut: !!onPopOut,
    showVoiceInput,
    showScreen: !!screenSettings && !!screenKnobSettings,
    showPresence: !!presenceSettings,
    showPacerGap: !!pacerGapSettings,
    showRateLimits: !!rateLimitSettings,
    showDevtools: !isWindow && !!onOpenDevtools,
    showHelp: !!onGuide,
    showMessage: !!onMessage,
    showHistory: !!transcript,
    showBrowser: !!browserSettings,
    showPreset: !!presetRegistry,
    showCharacters: !!presetRegistry && !!petWindows,
  });

  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
  const tablistEl = el.querySelector<HTMLDivElement>(".yui-tabs")!;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab"));
  const barEl = el.querySelector<HTMLDivElement>(".yui-quick__bar");

  // ── Reasoning effort — the agent section binds it; the connection tab mounts it after chat. ──
  const effortHost = document.createElement("div");
  effortHost.innerHTML = effortSectionHtml();

  // ── Connection page (URL fields · API key rows · TTS/Chat dropdowns · status line · resets) ──
  const connectionTab = createConnectionTab({
    endpointsSettings,
    chatKeySettings,
    ttsKeySettings,
    getEndpointDefaults,
    getDefaultChatApi,
    rows: { broker: true },
    pushSocket,
    isOpen: () => popover.isOpen(),
    getChatApiKey,
    getFetch,
    chatExtra: effortHost.firstElementChild as HTMLElement,
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
        stopTurn,
        announceSessionReset,
        pushSocket,
        getChatApi: () => (isPushMode() ? "push" : undefined),
        isOpen: () => popover.isOpen(),
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
    isOpen: () => popover.isOpen(),
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
    isOpen: () => popover.isOpen(),
  });

  // ── popover shell (position/drag/open-close lifecycle) ──
  const popover = createPopover({
    mount,
    root: el,
    scrim: scrimEl,
    bar: barEl,
    isWindow,
    closeWindow: onCloseWindow,
    visibleHeight: visibleViewport ? () => visibleViewport.get() : undefined,
    onOpen: () => {
      screenshot.reflect();
      browser?.reflect();
      switchRows.reflect();
      reactions.reflect();
      screen.reflect();
      voiceInput.reflect();
      agent.reflect();
      card.reflect();
      userName.reflect();
      sttKeyRow.reflect();
      filler.reflect();
      agent.reflectLanguage();
      appearance.reflect();
      connectionTab.refresh();
      // Opening on the Connection tab counts as entering it — the model list read follows.
      if (tabRail.selected() === "conn") connectionTab.entered();
      session.reflect();
      historyTab?.refresh();
      characters?.refresh();
      characterTab.refresh();
      speakerList.render();
      // Server may have come up after the app — refetch its voice list (store subscription re-renders).
      refreshVoiceList?.();
      screenshot.loadMonitorsIfEnabled();
    },
    onClose: () => {
      hintTooltip.hide();
      characterTab.close();
      speakerList.stopAudition();
      connectionTab.commit();
      sttKeyRow.commitIfDirty();
      connectionTab.close();
      presetStrip?.close();
    },
  });

  // ── Switch rows (click binding · store following while open) ──
  const switchRows = bindSwitchRows(el, TOGGLE_SPECS, log, popover.isOpen);

  // ── Screen section (screen-watch threshold knobs · min-gap slider) ──
  const screen = createScreenSection({
    root: el,
    screenSettings,
    screenKnobSettings,
    getScreenDefaults,
    reflectSwitchRows: () => switchRows.reflect(),
    isOpen: popover.isOpen,
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
    isOpen: popover.isOpen,
  });

  // ── Agent section (locale segment · reasoning-effort segment) ──
  const agent = createAgentSection({
    root: el,
    agentSettings,
    endpointsSettings,
    isPushMode,
    isOpen: popover.isOpen,
    log,
  });
  const appearance = createAppearanceSection({
    root: el,
    themeSettings,
    isOpen: popover.isOpen,
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
    isOpen: popover.isOpen,
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
    isOpen: popover.isOpen,
  });
  const sttKeyRow = createKeyRow({
    root: el,
    idPrefix: "sttkey",
    store: sttKeySettings,
    isOpen: popover.isOpen,
    log,
  });

  // ── Thinking filler section (language segment · phrase-pool textareas) ──
  const filler = createFillerSection({
    root: el,
    fillerSettings,
    isOpen: popover.isOpen,
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
    isOpen: popover.isOpen,
    log,
  });

  // ── Session section (context readout · delegated-work list and its minute refresh) ──
  const session = createSessionSection({
    root: el,
    sessionDiagnostics,
    pushSocket,
    isPushMode,
    delegations,
    isOpen: popover.isOpen,
  });

  // ── Screenshot section (attach switch · monitor list) ──
  const screenshot = createScreenshotSection({
    root: el,
    settings,
    sourceProvider,
    log,
    isOpen: popover.isOpen,
  });

  // ── Browser section (browser-use switch) ──
  const browser = browserSettings
    ? createBrowserSection({ root: el, settings: browserSettings, log, isOpen: popover.isOpen })
    : undefined;

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

  function openPanel(anchor?: { x: number; y: number }, opts?: { tab?: QuickControlsTab }): void {
    if (!visibleViewport) {
      openNow(anchor, opts?.tab);
      return;
    }
    void visibleViewport.refresh().then(() => {
      if (!disposed) openNow(anchor, opts?.tab);
    });
  }

  function openNow(anchor?: { x: number; y: number }, tab?: QuickControlsTab): void {
    // Select before opening so the panel is positioned around the tab the caller asked for.
    if (tab && tabRail.select(tab)) {
      popover.open(anchor);
      // open() lands focus on the first control; move it to the tab the caller asked for.
      tabRail.select(tab, { focusVisible: false });
    } else {
      popover.open(anchor);
    }
  }

  function selectedTab(): QuickControlsTab {
    return tabRail.selected() as QuickControlsTab;
  }

  // Cue-list components — both on the Proactive page: proactive in .yui-loop-cue-section, schedule in .yui-cue-sections.
  const loopCueMountEl = el.querySelector<HTMLDivElement>(".yui-loop-cue-section")!;

  const cueLists = mountCueLists({
    scheduleMount: cueSectionsMountEl,
    proactiveMount: loopCueMountEl,
    scheduleSettings,
    proactiveSettings,
  });

  // ── Header buttons (pop-out · message · devtools · close) ──
  const headerButtons = createHeaderButtons({
    root: el,
    close: popover.close,
    onPopOut,
    onMessage,
    onOpenDevtools,
  });
  // The popover closes first, as for the message button, so the reply is what the user sees next.
  // The separate settings window stays open.
  const unbindHelp = onGuide
    ? bindHelpSection(el, (guide, text) => {
        if (!isWindow) popover.close();
        onGuide(guide, text);
      })
    : undefined;
  // window variant is always visible, so open it immediately.
  if (isWindow) popover.open();

  function dispose(): void {
    disposed = true;
    connectionTab.dispose();
    workflows.dispose();
    screenshot.dispose();
    browser?.dispose();
    screen.dispose();
    reactions.dispose();
    agent.dispose();
    appearance.dispose();
    card.dispose();
    userName.dispose();
    sttKeyRow.dispose();
    filler.dispose();
    readings.dispose();
    voiceInput.dispose();
    session.dispose();
    hintTooltip.dispose();
    historyTab?.dispose();
    cueLists.destroy();
    switchRows.dispose();
    characterTab.dispose();
    speakerList.dispose();
    headerButtons.dispose();
    unbindHelp?.();
    popover.dispose();
    tabRail.dispose();
    unbindTransportLinks();
    unbindSearch();
    presetStrip?.dispose();
    characters?.dispose();
    el.remove();
    scrimEl.remove();
  }

  return {
    el,
    open: openPanel,
    selectedTab,
    close: popover.close,
    isOpen: popover.isOpen,
    dispose,
  };
}
