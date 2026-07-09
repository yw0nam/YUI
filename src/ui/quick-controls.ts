/**
 * Quick-controls 패널 — 우클릭으로 소환되는 설정 패널.
 * 드래그 가능한 헤더 + 탭 스트립(대화 · 캐릭터 · 입력 · 고급) + 탭 패널 본문으로 구성된다.
 * variant: "popover"(기본, 펫 창 안 도킹 + 드래그) | "window"(별도 OS 창, 풀 채움).
 */

import "./quick-controls.css";
import type { AvatarOption } from "../config/load";
import type { ScreenSource } from "../contract";
import type { createAgentNotifySettings } from "../io/agent-notify-settings";
import { type createAgentSettings, REASONING_EFFORTS } from "../io/agent-settings";
import type { ApiKeySettingsStore } from "../io/api-key-settings";
import type { createChatHistoryStore } from "../io/chat-history-store";
import type { ChatKeySettingsStore } from "../io/chat-key-settings";
import type { createEndpointsSettings, EndpointOverrides } from "../io/endpoints-settings";
import type { createFillerSettings } from "../io/filler-settings";
import type { createGazeSettings } from "../io/gaze-settings";
import type { createGithubSettings } from "../io/github-settings";
import type { createIdleThrottleSettings } from "../io/idle-throttle-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../io/lipsync-settings";
import type { createPresenceSettings } from "../io/presence-settings";
import type { createProactiveSettings } from "../io/proactive-settings";
import type { createScheduleSettings } from "../io/schedule-settings";
import type { MonitorInfo, ScreenSourceProvider } from "../io/screen-source-provider";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import type { createSessionDiagnosticsStore } from "../io/session-diagnostics";
import type { createSessionStore } from "../io/session-store";
import type { createSpeakerSelection, SpeakerOption } from "../io/speaker-selection";
import type { createTtsSettings } from "../io/tts-settings";
import { type createVadSettings, VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../io/vad-settings";
import type { createVrmSelection } from "../io/vrm-selection";
import { createLogger } from "../logger";
import { type CueListInstance, createCueList } from "./cue-list";
import { type Locale, setLocale, t } from "./i18n";
import { CHATKEY_EYE_OFF_SVG, CHATKEY_EYE_SVG, ENDPOINT_FIELDS } from "./quick-controls/constants";
import { createPopover } from "./quick-controls/popover";
import { createReflect, validateEndpointInput } from "./quick-controls/reflect";
import { createSpeakerList } from "./quick-controls/speaker-list";
import { buildPanelHtml } from "./quick-controls/template";
import { createVrmList } from "./quick-controls/vrm-list";
import type { VoiceInputStatus } from "./voice-input-status";

// formatTokenCount는 reflect 레이어에 산다 — 공개 API 호환을 위해 재노출한다.
export { formatTokenCount } from "./quick-controls/reflect";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type IdleThrottleSettingsStore = ReturnType<typeof createIdleThrottleSettings>;
type GazeSettingsStore = ReturnType<typeof createGazeSettings>;
type GithubSettingsStore = ReturnType<typeof createGithubSettings>;
type AgentNotifySettingsStore = ReturnType<typeof createAgentNotifySettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type ScheduleSettingsStore = ReturnType<typeof createScheduleSettings>;
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
type ChatHistoryStore = ReturnType<typeof createChatHistoryStore>;

interface QuickControlsOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  /** 유휴 절전(30fps 캡) on/off store. 끄면 항상 풀 프레임. */
  idleThrottleSettings: IdleThrottleSettingsStore;
  /** proactive 발화 on/off + 큐 목록 store. */
  proactiveSettings: ProactiveSettingsStore;
  /** 시각 기반 schedule cue on/off + 큐 목록 store. */
  scheduleSettings: ScheduleSettingsStore;
  sourceProvider: ScreenSourceProvider;
  voiceStatus: VoiceInputStatus;
  lipsync: LipsyncSettingsStore;
  /** STT 침묵 기준(ms) 단일값 store. 입력 탭의 슬라이더가 구동한다. */
  vad: VadSettingsStore;
  agentSettings: AgentSettingsStore;
  vrmSelection: VrmSelectionStore;
  /** 실제 스왑 수행 + 성공 시 store 커밋. 컴포넌트는 store.select를 직접 호출하지 않는다. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  /** 파일 선택 → 로드 → addUserOption + 선택까지의 전체 임포트 흐름. reject 시 인라인 에러. */
  importVrm: () => Promise<void>;
  /** 임포트된 VRM의 app-data 파일을 삭제(idempotent). store 제거와 별개로 호출한다. */
  removeUserVrm: (id: string) => Promise<void>;
  speakerSelection: SpeakerSelectionStore;
  /** 실제 화자 스왑 수행 + 성공 시 store 커밋. 컴포넌트는 store.select를 직접 호출하지 않는다. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** 화자의 참조 음성 재등록(PUT /voices). 서버 측 갱신만 — 화자 선택/store는 바꾸지 않는다. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** 파일 선택 → 등록 → addUserVoice + 선택까지의 전체 임포트 흐름. reject 시 인라인 에러. */
  importVoice: () => Promise<void>;
  /** 임포트된 음성의 app-data 파일을 삭제(idempotent). store 제거와 별개로 호출한다. */
  removeUserVoice: (id: string) => Promise<void>;
  /** 미리듣기 ref_url을 fetchable URL로 변환(주입 가능). 기본은 resolveAssetUrl. */
  resolveAuditionUrl?: (refUrl: string) => Promise<string>;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  /** Reset the camera viewpoint (orbit angles) to head-on. Renders the section when set. */
  onResetViewpoint?: () => void;
  onPopOut?: () => void;
  variant?: "popover" | "window";
  /** window variant에서 Escape가 OS 창을 닫는 경로(호스트 주입). 없으면 Escape는 no-op. */
  onCloseWindow?: () => void;
  /** 빈 instructions일 때 placeholder로 보여줄 기본 지침(config.chat_instructions). */
  getDefaultInstructions?: () => string | undefined;
  /** 사용자 편집 엔드포인트 오버라이드 store. 빈 값=폴백. */
  endpointsSettings: EndpointsSettingsStore;
  /** chat API 키 오버라이드 store. 빈 값=build-time 키 사용. 값은 시크릿 — 로깅 금지. */
  chatKeySettings: ChatKeySettingsStore;
  /** STT API 키 오버라이드 store. chat 키와 동일 패턴. 값은 시크릿 — 로깅 금지. */
  sttKeySettings: ApiKeySettingsStore;
  /** TTS(openai 호환) API 키 오버라이드 store. 값은 시크릿 — 로깅 금지. */
  ttsKeySettings: ApiKeySettingsStore;
  /** placeholder로 보여줄 bundled config 기본 엔드포인트(미로드 시 undefined). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** 오버라이드가 없을 때 음성 엔진 세그가 반영할 bundled config 기본 provider(미로드 시 undefined). */
  getDefaultProvider?: () => "openai" | "irodori" | undefined;
  /** 오버라이드가 없을 때 Chat API 드롭다운이 반영할 bundled config 기본값(미로드 시 undefined). */
  getDefaultChatApi?: () => string | undefined;
  /** 세션 진단(컨텍스트 사용량·마지막 압축). window variant에서만 세션 섹션을 그린다. */
  sessionDiagnostics?: SessionDiagnosticsStore;
  /** 현재 세션 id 포인터. "새 대화 시작"이 진단과 함께 비운다. */
  sessionStore?: SessionStore;
  /** 통합 대화 transcript. "새 대화 시작"이 세션 store들과 함께 비운다(없으면 no-op). */
  transcript?: Pick<ChatHistoryStore, "clear">;
  /** 생각중 추임새 설정 store. 없으면 섹션을 그리지 않는다(통합 에이전트가 주입). */
  fillerSettings?: FillerSettingsStore;
  /** TTS 음성 출력 on/off store. */
  ttsSettings?: TtsSettingsStore;
  /** 카메라 시선 맞춤(gaze) on/off store. 없으면 해당 토글 행을 그리지 않는다. */
  gazeSettings?: GazeSettingsStore;
  /** GitHub PR 워처 on/off store. 없으면 해당 토글 행을 그리지 않는다. */
  githubSettings?: GithubSettingsStore;
  /** 에이전트 완료 알림 on/off store. 없으면 해당 토글 행을 그리지 않는다. */
  agentNotifySettings?: AgentNotifySettingsStore;
  /** 자리 비움 감지 store. 없으면 Reactions 탭의 presence 행을 그리지 않는다. */
  presenceSettings?: PresenceSettingsStore;
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

// ponytail: single boolean, so it's read/written to localStorage directly — no settings-store
// class for one flag. Guarded so tests/non-browser environments without localStorage don't throw.
const RAIL_COLLAPSED_KEY = "yui.quickControls.railCollapsed";

function loadRailCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(RAIL_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveRailCollapsed(collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(RAIL_COLLAPSED_KEY, String(collapsed));
  } catch {
    // localStorage 사용 불가 시 no-op
  }
}

export function createQuickControls({
  mount,
  settings,
  idleThrottleSettings,
  proactiveSettings,
  scheduleSettings,
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
  githubSettings,
  agentNotifySettings,
  presenceSettings,
}: QuickControlsOptions): QuickControls {
  const isWindow = variant === "window";
  // 세션 섹션은 설정 창(window)에서만, 두 store가 모두 주입됐을 때 그린다.
  const hasSession = isWindow && !!sessionDiagnostics && !!sessionStore;
  // variant 태그로 어느 창이 만든 로그인지 구분(Tauri가 두 창 로그를 한 파일로 병합).
  const log = createLogger(isWindow ? "settings-ui" : "quick-ui");

  // scrim(바깥 클릭 감지)은 popover variant에서만 쓴다.
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
    showGithub: !!githubSettings,
    githubEnabled: githubSettings?.get().enabled ?? false,
    showAgentNotify: !!agentNotifySettings,
    agentNotifyEnabled: agentNotifySettings?.get().enabled ?? false,
    ttsEnabled: ttsSettings?.get().enabled ?? true,
    bargeInEnabled: vad.get().bargeIn,
    showPresence: !!presenceSettings,
    railCollapsed: loadRailCollapsed(),
  });

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const idleThrottleSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
  const gazeSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-gaze-switch");
  const githubSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-github-switch");
  const agentNotifySwitchBtn = el.querySelector<HTMLButtonElement>(".yui-agentnotify-switch");
  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
  const githubPollInput = el.querySelector<HTMLInputElement>("#yui-github-poll");
  const agentPortInput = el.querySelector<HTMLInputElement>("#yui-agent-port");
  const presenceInput = el.querySelector<HTMLInputElement>("#yui-presence");
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const ttsSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-tts-switch");
  const bargeInSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-bargein-switch");
  const monitorsEl = el.querySelector<HTMLDivElement>(".yui-monitors")!;
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
  // TTS 엔진 드롭다운 + irodori/openai 서브뷰 컨테이너(고급 탭). 화자 비활성 노드는 그대로.
  const ttsTypeEl = el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  // Chat API 드롭다운(고급 탭) — 서브뷰 없음(tts_provider와 달리 mode-exclusive 필드가 없다).
  const chatTypeEl = el.querySelector<HTMLSelectElement>(".yui-chat-type")!;
  const spkAddBtn = el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;
  // 시점 리셋 버튼 — onResetViewpoint 주입 시에만 존재한다(없으면 null).
  const viewpointResetBtn = el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset");
  // 생각중 추임새 섹션 노드 — fillerSettings 주입 시에만 존재한다(없으면 null).
  const fillerSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-filler-switch");
  const fillerLangSegEl = el.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const fillerFirstTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-first-textarea");
  const fillerRepeatTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-repeat-textarea",
  );
  const fillerLangBtns = fillerLangSegEl
    ? Array.from(fillerLangSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];
  // 언어 피커 세그(3칸) 노드.
  const langSegEl = el.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  // 엔드포인트 입력 — 필드 key별 input 노드 맵.
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    epInputs.set(key, el.querySelector<HTMLInputElement>(`#yui-ep-${key}`)!);
  }
  // per-section reset 버튼 — data-svc-reset 별 노드 맵.
  const svcResetBtns = new Map<string, HTMLButtonElement>();
  for (const btn of el.querySelectorAll<HTMLButtonElement>(".yui-svc-reset")) {
    svcResetBtns.set(btn.dataset.svcReset ?? "", btn);
  }

  // ── 서비스별 API 키 행(시크릿) — chat/stt/tts를 한 팩토리로 찍는다 ──
  // 값은 시크릿이므로 input.value에만 살고, sublabel/aria는 상태만 노출한다.
  // 타이핑은 store에 commit하지 않는다(중간 prefix가 라이브 키가 되는 걸 막음). blur·close·dispose에 한 번 commit.
  interface KeyRow {
    reflect(): void;
    commitIfDirty(): void;
    subscribe(): () => void;
    addListeners(): void;
    removeListeners(): void;
  }
  function createKeyRow(idPrefix: string, i18nPrefix: string, store: ApiKeySettingsStore): KeyRow {
    const row = el.querySelector<HTMLDivElement>(`.yui-input-row[data-key-prefix="${idPrefix}"]`)!;
    const input = row.querySelector<HTMLInputElement>(".yui-chatkey__input")!;
    const subEl = row.querySelector<HTMLSpanElement>(".yui-input-row__sub")!;
    const toggleBtn = row.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
    const clearBtn = row.querySelector<HTMLButtonElement>(".yui-chatkey__clear")!;
    let dirty = false;

    function reflect(): void {
      const key = store.get().apiKey;
      if (document.activeElement !== input && input.value !== key) {
        input.value = key;
        dirty = false;
      }
      subEl.textContent = key ? t(`${i18nPrefix}.sub_override`) : t(`${i18nPrefix}.sub_default`);
    }
    function commitIfDirty(): void {
      if (!dirty) return;
      dirty = false;
      const v = input.value;
      if (v) store.setApiKey(v);
      else store.clear();
    }
    function handleInput(): void {
      dirty = true;
    }
    function handleBlur(): void {
      commitIfDirty();
      reflect();
    }
    function handleToggle(): void {
      const show = toggleBtn.getAttribute("aria-pressed") !== "true";
      toggleBtn.setAttribute("aria-pressed", String(show));
      input.type = show ? "text" : "password";
      toggleBtn.innerHTML = show ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG;
      const label = show ? t(`${i18nPrefix}.hide`) : t(`${i18nPrefix}.show`);
      toggleBtn.setAttribute("aria-label", label);
      toggleBtn.title = label;
    }
    function handleClear(): void {
      dirty = false;
      input.value = "";
      store.clear();
      log.info(`${idPrefix}_clear`);
    }
    return {
      reflect,
      commitIfDirty,
      subscribe: () =>
        store.subscribe(() => {
          if (popover.isOpen()) reflect();
        }),
      addListeners() {
        input.addEventListener("input", handleInput);
        input.addEventListener("blur", handleBlur);
        toggleBtn.addEventListener("click", handleToggle);
        clearBtn.addEventListener("click", handleClear);
      },
      removeListeners() {
        input.removeEventListener("input", handleInput);
        input.removeEventListener("blur", handleBlur);
        toggleBtn.removeEventListener("click", handleToggle);
        clearBtn.removeEventListener("click", handleClear);
      },
    };
  }
  const chatKeyRow = createKeyRow("chatkey", "chatkey", chatKeySettings);
  const sttKeyRow = createKeyRow("sttkey", "sttkey", sttKeySettings);
  const ttsKeyRow = createKeyRow("ttskey", "ttskey", ttsKeySettings);
  const keyRows = [chatKeyRow, sttKeyRow, ttsKeyRow];

  // 세션 섹션 노드(window 전용 — 없으면 null).
  const sessionResetBtn = el.querySelector<HTMLButtonElement>(".yui-session__reset");
  // 큐 행도 .yui-confirm 패턴을 쓰므로 세션 것으로 한정한다.
  const sessionConfirmEl = el.querySelector<HTMLDivElement>(".yui-session .yui-confirm");
  const sessionConfirmBtn = el.querySelector<HTMLButtonElement>(".yui-session__confirm");
  const sessionCancelBtn = el.querySelector<HTMLButtonElement>(".yui-session__cancel");

  gainSlider.min = String(LIPSYNC_GAIN_MIN);
  gainSlider.max = String(LIPSYNC_GAIN_MAX);
  gainSlider.step = "0.1";

  vadSlider.min = String(VAD_SILENCE_MIN);
  vadSlider.max = String(VAD_SILENCE_MAX);
  vadSlider.step = "50";

  // 기본 지침 placeholder.
  const defaultInstr = getDefaultInstructions?.();
  instructionsEl.placeholder =
    defaultInstr && defaultInstr.length > 0 ? defaultInstr : t("instructions.placeholder_default");

  // 엔드포인트 placeholder — bundled config 기본값(greyed)으로 채운다(미로드 시 빈 채로 둠).
  const epDefaults = getEndpointDefaults?.();
  if (epDefaults) {
    for (const { key } of ENDPOINT_FIELDS) {
      epInputs.get(key)!.placeholder = epDefaults[key];
    }
  }

  let gainPreviewing = false;
  let monitorsLoaded = false;
  // dispose 후 in-flight refresh가 무너진 DOM에 재그림/타이머를 쓰지 않게 막는다.
  let disposed = false;
  // 화자 활성 기준선 — 열릴 때 재동기화(닫힌 새 provider 변경이 stale하게 남지 않게).
  let lastSpkEnabled = false;

  // ── reflect (store→DOM 동기화) 레이어 ──
  const reflect = createReflect({
    root: el,
    settings,
    idleThrottleSettings,
    ttsSettings,
    gazeSettings,
    githubSettings,
    agentNotifySettings,
    lipsync,
    vad,
    agentSettings,
    fillerSettings,
    endpointsSettings,
    sessionDiagnostics,
    keyRows,
    getEndpointDefaults,
    getDefaultProvider,
    getDefaultChatApi,
    githubPollInput: githubPollInput ?? undefined,
    agentPortInput: agentPortInput ?? undefined,
    presenceInput: presenceInput ?? undefined,
    presenceSettings,
  });

  function renderMonitors(monitors: MonitorInfo[], currentSource: ScreenSource): void {
    monitorsEl.innerHTML = "";
    for (const mon of monitors) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      const selected = currentSource.kind === "monitor" && currentSource.index === mon.index;
      btn.setAttribute("aria-checked", String(selected));
      btn.className = "yui-mon";

      const metaText =
        mon.width !== undefined && mon.height !== undefined ? `${mon.width} × ${mon.height}` : "";
      const badgeHtml = mon.primary
        ? `<span class="yui-mon__badge">${t("screenshot.monitor_primary")}</span>`
        : "";

      btn.innerHTML = `
        <span class="yui-mon__tick" aria-hidden="true"></span>
        <span class="yui-mon__body">
          <span class="yui-mon__name">${t("screenshot.display", { n: mon.index + 1 })}</span>
          ${metaText ? `<span class="yui-mon__meta">${metaText}</span>` : ""}
        </span>
        ${badgeHtml}
      `;

      btn.addEventListener("click", () => {
        const label = mon.label ?? t("screenshot.display", { n: mon.index + 1 });
        const source: ScreenSource = { kind: "monitor", index: mon.index, label };
        settings.setSource(source);
        // 라디오 상태 즉시 반영
        monitorsEl.querySelectorAll<HTMLButtonElement>(".yui-mon").forEach((b) => {
          b.setAttribute("aria-checked", "false");
        });
        btn.setAttribute("aria-checked", "true");
      });

      monitorsEl.appendChild(btn);
    }
  }

  async function loadMonitors(): Promise<void> {
    const monitors = await sourceProvider.listMonitors();
    monitorsLoaded = true;
    renderMonitors(monitors, settings.get().source);
  }

  // ── VRM 섹션 ──

  const vrmList = createVrmList({ root: el, vrmSelection, swapVrm, importVrm, removeUserVrm, log });

  // ── 화자 섹션 ──
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

  // ── popover 셸 (위치·드래그·open/close 라이프사이클) ──
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
      reflect.reflectGithub();
      reflect.reflectAgentNotify();
      reflect.reflectPresence();
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
      // 닫힌 동안 provider가 바뀌었을 수 있으니 열릴 때 기준선을 재동기화한다.
      lastSpkEnabled = speakerControlsEnabled();
      speakerList.render();
      if (settings.get().enabled && !monitorsLoaded) {
        void loadMonitors();
      }
    },
    onClose: () => {
      if (gainPreviewing) {
        onGainPreviewEnd();
        gainPreviewing = false;
      }
      speakerList.stopAudition();
      for (const r of keyRows) r.commitIfDirty();
    },
  });

  // ── 이벤트 핸들러 ──

  function handleSwitchClick(): void {
    const current = settings.get().enabled;
    settings.setEnabled(!current);
    log.info("screenshot_attach_toggle", { enabled: !current });
    if (!current && !monitorsLoaded) {
      void loadMonitors();
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

  function handleGithubSwitchClick(): void {
    if (!githubSettings) return;
    const current = githubSettings.get().enabled;
    githubSettings.setEnabled(!current);
    log.info("github_watch_toggle", { enabled: !current });
  }

  function handleAgentNotifySwitchClick(): void {
    if (!agentNotifySettings) return;
    const current = agentNotifySettings.get().enabled;
    agentNotifySettings.setEnabled(!current);
    log.info("agent_notify_toggle", { enabled: !current });
  }

  // ── 생각중 추임새 이벤트 핸들러 ──

  function handleFillerSwitchClick(): void {
    if (!fillerSettings) return;
    fillerSettings.setEnabled(!fillerSettings.get().enabled);
  }

  // textarea 한 칸을 줄 단위로 파싱(trim + 빈 줄 제거).
  function parseFillerLines(el: HTMLTextAreaElement | null): string[] {
    if (!el) return [];
    return el.value
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  const FILLER_LANGS = ["ja", "en", "ko"] as const;

  // 세그 선택 이동 + focus. aria/tabindex는 store 구독(reflectFiller)이 갱신한다.
  function selectFillerLang(index: number, focus = false): void {
    if (!fillerSettings) return;
    const clamped = Math.min(FILLER_LANGS.length - 1, Math.max(0, index));
    const lang = FILLER_LANGS[clamped];
    fillerSettings.setLanguage(lang);
    // 언어가 바뀌면 두 textarea를 새 언어의 pool로 즉시 갱신(store 구독보다 선행).
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

  // 추론 강도 세그와 같은 로빙-포커스 키보드. 화살표는 선택+focus, Space/Enter는 대상 선택.
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

  // 언어 피커 — WAI-ARIA "선택이 포커스를 따르지 않는" 라디오 패턴.
  // setLocale은 UI 전체 언어를 바꾸고 호스트 재마운트를 유발하므로(비쌈·파괴적),
  // 화살표는 포커스만 옮기고 Space/Enter·클릭에서만 커밋한다.

  // 화살표/Home/End — roving tabindex + 포커스만 이동(커밋·aria-checked 변경 없음).
  function moveLocaleFocus(index: number): void {
    const clamped = Math.min(langSegButtons.length - 1, Math.max(0, index));
    const btn = langSegButtons[clamped];
    if (!btn) return;
    for (const b of langSegButtons) b.tabIndex = -1;
    btn.tabIndex = 0;
    btn.focus();
  }

  // 커밋(클릭·Space·Enter) — 표시 언어를 실제로 바꾸는 유일한 경로.
  function commitLocale(index: number): void {
    const clamped = Math.min(langSegButtons.length - 1, Math.max(0, index));
    const locale = langSegButtons[clamped]?.dataset.locale as Locale | undefined;
    if (!locale) return;
    log.info("ui_language_change", { locale });
    setLocale(locale);
    // locale seg엔 store 구독이 없다 — 재마운트 전까지의 aria/tabindex를 직접 반영한다.
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
    // 화살표 기준은 현재 포커스한 라디오(없으면 체크된 것, 그것도 없으면 0).
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
      e.preventDefault(); // 네이티브 버튼 클릭 중복 커밋 방지
      commitLocale(idx);
    }
  }

  // 어느 칸을 편집하든 두 칸의 현재 값을 함께 써서 다른 칸을 덮어쓰지 않게 한다.
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

  // openai 엔진에선 화자 관리가 비활성 — 프로그래매틱 클릭(테스트)도 게이팅한다.
  function speakerControlsEnabled(): boolean {
    return reflect.effectiveProvider() === "irodori";
  }

  function handlePopOut(): void {
    onPopOut?.();
  }

  // ── 대화 섹션: 추론 강도 세그먼트 ──

  function selectEffort(index: number, focus = false): void {
    const clamped = Math.min(REASONING_EFFORTS.length - 1, Math.max(0, index));
    const effort = REASONING_EFFORTS[clamped];
    agentSettings.setReasoningEffort(effort);
    log.info("reasoning_effort_change", { effort });
    // store 구독으로 reflect.reflectAgent가 시각/aria를 갱신한다.
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

  // ── 고급 섹션: TTS 엔진 드롭다운(tts_provider) ──
  // native select가 키보드를 소유한다 — change 이벤트로만 store에 쓴다.
  function handleTtsTypeChange(): void {
    const provider = ttsTypeEl.value;
    if (provider !== "irodori" && provider !== "openai") return;
    endpointsSettings.set({ tts_provider: provider });
    log.info("voice_engine_change", { provider });
    // store 구독(unsubscribeEndpoints)이 reflect.reflectVoiceEngine으로 값/서브뷰/화자 비활성을 갱신한다.
  }

  // ── 고급 섹션: Chat API 드롭다운(chat_api) — 서브뷰 없음(shared fields) ──
  function handleChatTypeChange(): void {
    const api = chatTypeEl.value;
    if (api !== "responses" && api !== "chat_completions") return;
    endpointsSettings.set({ chat_api: api });
    log.info("chat_api_change", { api });
    // store 구독(unsubscribeEndpoints)이 reflect.reflectChatType으로 값/summary hint를 갱신한다.
  }

  // ── 대화 섹션: 지침 textarea ──

  function handleInstructionsInput(): void {
    agentSettings.setInstructions(instructionsEl.value);
    log.info("instructions_change", { length: instructionsEl.value.length });
  }

  // blur 시점에 입력 중 보류된 원격 변경을 반영한다.
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

  // ── 엔드포인트 섹션 ──

  function handleEndpointInput(e: Event): void {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const row = input.closest<HTMLDivElement>(".yui-input-row");
    const key = row?.dataset.epField as keyof EndpointOverrides | undefined;
    if (!key) return;
    endpointsSettings.set({ [key]: input.value });
    validateEndpointInput(key, input);
  }

  // blur 시점에 입력 중 보류된 원격 변경을 반영한다(지침 textarea와 동일).
  function handleEndpointBlur(): void {
    reflect.reflectEndpoints();
  }

  // ── 서비스별 초기화(per-section reset) ──
  // 각 섹션이 비우는 엔드포인트 필드 + 키 store. URL/모델은 ""로, 키는 .clear()로 되돌린다.
  const SVC_RESET_FIELDS: Record<string, (keyof EndpointOverrides)[]> = {
    chat: ["chat_base_url", "chat_model"],
    stt: ["stt_base_url"],
    tts: ["irodori_base_url", "tts_base_url", "tts_voice"],
    broker: ["broker_base_url"],
  };
  const SVC_RESET_KEY: Record<string, ApiKeySettingsStore | undefined> = {
    chat: chatKeySettings,
    stt: sttKeySettings,
    tts: ttsKeySettings,
    broker: undefined,
  };

  function handleSvcReset(svc: string): void {
    const fields = SVC_RESET_FIELDS[svc];
    if (!fields) return;
    const patch: Partial<EndpointOverrides> = {};
    for (const key of fields) patch[key] = "";
    if (svc === "tts") patch.tts_provider = "";
    // chat_api is a dropdown enum (like tts_provider) — not in ENDPOINT_FIELDS/epInputs, so it's
    // patched directly rather than through the text-input reset loop below.
    if (svc === "chat") patch.chat_api = "";
    endpointsSettings.set(patch);
    for (const key of fields) {
      const input = epInputs.get(key)!;
      input.value = "";
      validateEndpointInput(key, input);
    }
    SVC_RESET_KEY[svc]?.clear();
    log.info("svc_reset", { svc });
  }

  // ── 세션 섹션: 새 대화 시작(reset) ──

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

  // ── 게인 슬라이더 ──

  function handleGainInput(): void {
    const v = parseFloat(gainSlider.value);
    lipsync.setGain(v); // 값 변경 시 lipsync 구독이 reflect.reflectGain으로 게인 행을 다시 그린다
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

  // ── 침묵 기준(VAD) 슬라이더 ──

  function handleVadInput(): void {
    const ms = parseInt(vadSlider.value, 10);
    vad.setSilenceMs(ms); // store 구독이 reflect.reflectVad로 값 행을 다시 그린다
  }

  function handleVadEnd(): void {
    log.info("vad_silence_change", { silenceMs: parseInt(vadSlider.value, 10) });
  }

  // ── 탭 전환 ──
  // aria-selected/hidden + roving tabindex만 토글. 화살표(←/→/Home/End)는 즉시 활성.

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

  // ── 섹션 rail 접기/펼치기 ──

  function handleRailCollapseClick(): void {
    const collapsed = !railColsEl.classList.contains("is-rail-collapsed");
    railColsEl.classList.toggle("is-rail-collapsed", collapsed);
    railCollapseBtn.setAttribute("aria-expanded", String(!collapsed));
    const label = t(collapsed ? "panel.rail_expand" : "panel.rail_collapse");
    railCollapseBtn.setAttribute("aria-label", label);
    railCollapseBtn.title = label;
    saveRailCollapsed(collapsed);
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

  // ── 구독 ──

  const unsubscribe = settings.subscribe((s) => {
    if (!popover.isOpen()) return;
    switchBtn.setAttribute("aria-checked", String(s.enabled));
    el.classList.toggle("is-on", s.enabled);
    if (s.enabled && !monitorsLoaded) {
      void loadMonitors();
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
  const unsubscribeGithub = githubSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectGithub();
  });
  const unsubscribeAgentNotify = agentNotifySettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectAgentNotify();
  });
  const unsubscribePresence = presenceSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectPresence();
  });

  function handleGithubPollChange(): void {
    if (!githubSettings || !githubPollInput) return;
    const v = Math.round(Number(githubPollInput.value));
    githubSettings.setPollInterval(v * 1000);
    reflect.reflectGithub();
  }
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
  githubPollInput?.addEventListener("change", handleGithubPollChange);
  agentPortInput?.addEventListener("change", handleAgentPortChange);
  presenceInput?.addEventListener("change", handlePresenceChange);

  // 큐 목록 컴포넌트 — schedule은 입력 탭 .yui-cue-sections, proactive는 Reactions 탭 .yui-loop-cue-section.
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
      // provider 변경으로 화자 활성이 바뀌면 목록을 다시 그려 disabled를 재평가한다.
      const nowSpkEnabled = speakerControlsEnabled();
      if (nowSpkEnabled !== lastSpkEnabled) {
        lastSpkEnabled = nowSpkEnabled;
        speakerList.render();
      }
    }
  });
  // 키 store 갱신(이 창 편집·다른 창 reloadFromStorage)을 각 행에 반영. 값은 시크릿.
  const unsubscribeKeyRows = keyRows.map((r) => r.subscribe());
  // 생각중 추임새 store 갱신을 섹션에 반영(다른 창 reloadFromStorage 포함).
  const unsubscribeFiller = fillerSettings?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectFiller();
  });
  // store 갱신(직접 select·다른 창 reloadFromStorage)을 active 행에 반영.
  // 스왑 진행 중엔 건너뛴다 — finally의 renderVrms가 로딩 해제 후 최종 그림을 맡는다.
  const unsubscribeVrm = vrmSelection.subscribe(() => {
    if (popover.isOpen() && !vrmList.isSwapping()) vrmList.render();
  });
  // 화자 store 갱신(직접 select·다른 창 reloadFromStorage)을 active 행에 반영.
  // 스왑 진행 중엔 건너뛴다 — finally의 renderSpeakers가 로딩 해제 후 최종 그림을 맡는다.
  const unsubscribeSpk = speakerSelection.subscribe(() => {
    if (popover.isOpen() && !speakerList.isSwapping()) speakerList.render();
  });
  // 세션 진단 갱신(이 창의 reset·펫 창 reloadFromStorage)을 readout에 반영.
  const unsubscribeSession = sessionDiagnostics?.subscribe(() => {
    if (popover.isOpen()) reflect.reflectSession();
  });

  switchBtn.addEventListener("click", handleSwitchClick);
  idleThrottleSwitchBtn.addEventListener("click", handleIdleThrottleSwitchClick);
  ttsSwitchBtn?.addEventListener("click", handleTtsSwitchClick);
  bargeInSwitchBtn?.addEventListener("click", handleBargeInSwitchClick);
  gazeSwitchBtn?.addEventListener("click", handleGazeSwitchClick);
  githubSwitchBtn?.addEventListener("click", handleGithubSwitchClick);
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
  ttsTypeEl.addEventListener("change", handleTtsTypeChange);
  chatTypeEl.addEventListener("change", handleChatTypeChange);
  vrmsEl.addEventListener("keydown", vrmList.handleKeydown);
  vrmAddBtn.addEventListener("click", vrmList.handleAddClick);
  spksEl.addEventListener("keydown", speakerList.handleKeydown);
  spkAddBtn.addEventListener("click", speakerList.handleAddClick);
  instructionsEl.addEventListener("input", handleInstructionsInput);
  instructionsEl.addEventListener("blur", handleInstructionsBlur);
  resetBtn.addEventListener("click", handleResetInstructions);
  viewpointResetBtn?.addEventListener("click", handleResetViewpoint);
  for (const input of epInputs.values()) {
    input.addEventListener("input", handleEndpointInput);
    input.addEventListener("blur", handleEndpointBlur);
  }
  const svcResetListeners = new Map<HTMLButtonElement, () => void>();
  for (const [svc, btn] of svcResetBtns) {
    const handler = (): void => handleSvcReset(svc);
    svcResetListeners.set(btn, handler);
    btn.addEventListener("click", handler);
  }
  for (const r of keyRows) r.addListeners();
  sessionResetBtn?.addEventListener("click", showSessionConfirm);
  sessionConfirmBtn?.addEventListener("click", handleSessionReset);
  sessionCancelBtn?.addEventListener("click", hideSessionConfirm);
  popOutBtn?.addEventListener("click", handlePopOut);
  closeBtn?.addEventListener("click", popover.close);
  // 창 variant는 항상 보이므로 즉시 연다.
  if (isWindow) popover.open();

  function dispose(): void {
    disposed = true;
    for (const r of keyRows) r.commitIfDirty();
    scheduleCueList?.destroy();
    proactiveCueList?.destroy();
    unsubscribe();
    unsubscribeIdleThrottle();
    unsubscribeTts?.();
    unsubscribeGaze?.();
    unsubscribeGithub?.();
    unsubscribeAgentNotify?.();
    unsubscribePresence?.();
    githubPollInput?.removeEventListener("change", handleGithubPollChange);
    agentPortInput?.removeEventListener("change", handleAgentPortChange);
    presenceInput?.removeEventListener("change", handlePresenceChange);
    unsubscribeVoice();
    unsubscribeLipsync();
    unsubscribeVad();
    unsubscribeAgent();
    unsubscribeEndpoints();
    for (const unsub of unsubscribeKeyRows) unsub();
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
    githubSwitchBtn?.removeEventListener("click", handleGithubSwitchClick);
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
    ttsTypeEl.removeEventListener("change", handleTtsTypeChange);
    chatTypeEl.removeEventListener("change", handleChatTypeChange);
    vrmsEl.removeEventListener("keydown", vrmList.handleKeydown);
    vrmAddBtn.removeEventListener("click", vrmList.handleAddClick);
    spksEl.removeEventListener("keydown", speakerList.handleKeydown);
    spkAddBtn.removeEventListener("click", speakerList.handleAddClick);
    instructionsEl.removeEventListener("input", handleInstructionsInput);
    instructionsEl.removeEventListener("blur", handleInstructionsBlur);
    resetBtn.removeEventListener("click", handleResetInstructions);
    viewpointResetBtn?.removeEventListener("click", handleResetViewpoint);
    for (const input of epInputs.values()) {
      input.removeEventListener("input", handleEndpointInput);
      input.removeEventListener("blur", handleEndpointBlur);
    }
    for (const [btn, handler] of svcResetListeners) btn.removeEventListener("click", handler);
    for (const r of keyRows) r.removeListeners();
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
