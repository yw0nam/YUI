/**
 * Quick-controls 패널 — 우클릭으로 소환되는 설정 패널.
 * 드래그 가능한 헤더 + 탭 스트립(대화 · 캐릭터 · 입력 · 고급) + 탭 패널 본문으로 구성된다.
 * variant: "popover"(기본, 펫 창 안 도킹 + 드래그) | "window"(별도 OS 창, 풀 채움).
 */

import "./quick-controls.css";
import type { AvatarOption } from "../config/load";
import type { ScreenSource } from "../contract";
import { type createAgentSettings, REASONING_EFFORTS } from "../io/agent-settings";
import type { ApiKeySettingsStore } from "../io/api-key-settings";
import type { ChatKeySettingsStore } from "../io/chat-key-settings";
import {
  type createEndpointsSettings,
  type EndpointOverrides,
  isValidEndpointUrl,
} from "../io/endpoints-settings";
import type { createFillerSettings } from "../io/filler-settings";
import type { createGazeSettings } from "../io/gaze-settings";
import type { createIdleThrottleSettings } from "../io/idle-throttle-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../io/lipsync-settings";
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
import { getLocale, type Locale, setLocale, t } from "./i18n";
import {
  CHATKEY_EYE_OFF_SVG,
  CHATKEY_EYE_SVG,
  ENDPOINT_FIELDS,
  LANG_PICKER_ORDER,
  VOICE_ENGINE_LABEL_KEYS,
  type VoiceEngine,
} from "./quick-controls/constants";
import { createSpeakerList } from "./quick-controls/speaker-list";
import { buildPanelHtml } from "./quick-controls/template";
import { createVrmList } from "./quick-controls/vrm-list";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "./voice-input-status";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type IdleThrottleSettingsStore = ReturnType<typeof createIdleThrottleSettings>;
type GazeSettingsStore = ReturnType<typeof createGazeSettings>;
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
  /** 세션 진단(컨텍스트 사용량·마지막 압축). window variant에서만 세션 섹션을 그린다. */
  sessionDiagnostics?: SessionDiagnosticsStore;
  /** 현재 세션 id 포인터. "새 대화 시작"이 진단과 함께 비운다. */
  sessionStore?: SessionStore;
  /** 생각중 추임새 설정 store. 없으면 섹션을 그리지 않는다(통합 에이전트가 주입). */
  fillerSettings?: FillerSettingsStore;
  /** TTS 음성 출력 on/off store. */
  ttsSettings?: TtsSettingsStore;
  /** 카메라 시선 맞춤(gaze) on/off store. 없으면 해당 토글 행을 그리지 않는다. */
  gazeSettings?: GazeSettingsStore;
}

interface QuickControls {
  el: HTMLElement;
  open(anchor?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const VIEWPORT_MARGIN = 12;
const POS_KEY = "yui.quick.pos";

export const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

// 토큰 수를 "18.2K" / "18K" / "200K" 꼴로 줄여 표기한다. 1000 미만은 그대로,
// 100K 미만은 소수 1자리(다만 .0은 떼고), 이상은 정수.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}K`;
  return `${k.toFixed(1).replace(/\.0$/, "")}K`;
}

interface SavedPos {
  x: number;
  y: number;
}

function loadSavedPos(): SavedPos | null {
  try {
    const raw = globalThis.localStorage?.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedPos>;
    if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function savePos(pos: SavedPos): void {
  try {
    globalThis.localStorage?.setItem(POS_KEY, JSON.stringify(pos));
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
  getDefaultInstructions,
  endpointsSettings,
  chatKeySettings,
  sttKeySettings,
  ttsKeySettings,
  getEndpointDefaults,
  getDefaultProvider,
  sessionDiagnostics,
  sessionStore,
  fillerSettings,
  ttsSettings,
  gazeSettings,
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
    ttsEnabled: ttsSettings?.get().enabled ?? true,
  });

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const idleThrottleSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
  const gazeSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-gaze-switch");
  const cueSectionsMountEl = el.querySelector<HTMLDivElement>(".yui-cue-sections")!;
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const ttsSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-tts-switch");
  const monitorsEl = el.querySelector<HTMLDivElement>(".yui-monitors")!;
  const vrmsEl = el.querySelector<HTMLDivElement>(".yui-vrms")!;
  const vrmAddBtn = el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
  const spksEl = el.querySelector<HTMLDivElement>(".yui-spks")!;
  const gainSlider = el.querySelector<HTMLInputElement>(".yui-gain__slider:not(.yui-vad__slider)")!;
  const gainValue = el.querySelector<HTMLSpanElement>(".yui-gain__value:not(.yui-vad__value)")!;
  const vadSlider = el.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const vadValue = el.querySelector<HTMLSpanElement>(".yui-vad__value")!;
  const tablistEl = el.querySelector<HTMLDivElement>(".yui-tabs")!;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab"));
  const barEl = el.querySelector<HTMLDivElement>(".yui-quick__bar");
  const popOutBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");
  const segEl = el.querySelector<HTMLDivElement>(".yui-field-row .yui-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  // TTS 엔진 드롭다운 + irodori/openai 서브뷰 컨테이너(고급 탭). 화자 비활성 노드는 그대로.
  const ttsTypeEl = el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  const ttsIrodoriEl = el.querySelector<HTMLDivElement>(".yui-tts-irodori")!;
  const ttsOpenaiEl = el.querySelector<HTMLDivElement>(".yui-tts-openai")!;
  const ttsSummaryHintEl = el.querySelector<HTMLSpanElement>(".yui-tts-summary-hint")!;
  const spkScrollEl = el.querySelector<HTMLDivElement>(".yui-spk-scroll")!;
  const spkFootEl = el.querySelector<HTMLDivElement>(".yui-spk-foot")!;
  const spksHintEl = el.querySelector<HTMLParagraphElement>(".yui-spks-hint")!;
  const spkAddBtn = el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;
  // 시점 리셋 버튼 — onResetViewpoint 주입 시에만 존재한다(없으면 null).
  const viewpointResetBtn = el.querySelector<HTMLButtonElement>(".yui-viewpoint-reset");
  // 생각중 추임새 섹션 노드 — fillerSettings 주입 시에만 존재한다(없으면 null).
  const fillerSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-filler-switch");
  const fillerLangSegEl = el.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const fillerLangBtns = fillerLangSegEl
    ? Array.from(fillerLangSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];
  const fillerFirstTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-first-textarea");
  const fillerRepeatTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-repeat-textarea",
  );
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
          if (openState) reflect();
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
  const sessionStatEl = el.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = el.querySelector<HTMLSpanElement>(".yui-session__value");
  const sessionResetBtn = el.querySelector<HTMLButtonElement>(".yui-session__reset");
  const sessionConfirmEl = el.querySelector<HTMLDivElement>(".yui-confirm");
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

  let openState = false;
  let gainPreviewing = false;
  let closeRafId: number | null = null;
  let monitorsLoaded = false;
  // dispose 후 in-flight refresh가 무너진 DOM에 재그림/타이머를 쓰지 않게 막는다.
  let disposed = false;

  // ── DOM 동기화 ──

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    el.classList.toggle("is-on", on);
  }

  function reflectIdleThrottle(): void {
    idleThrottleSwitchBtn.setAttribute("aria-checked", String(idleThrottleSettings.get().enabled));
  }

  function reflectTts(): void {
    if (!ttsSwitchBtn || !ttsSettings) return;
    ttsSwitchBtn.setAttribute("aria-checked", String(ttsSettings.get().enabled));
  }

  function reflectGaze(): void {
    if (!gazeSwitchBtn || !gazeSettings) return;
    gazeSwitchBtn.setAttribute("aria-checked", String(gazeSettings.get().enabled));
  }

  function reflectGain(): void {
    const gain = lipsync.get().gain;
    gainSlider.value = String(gain);
    gainValue.textContent = `${gain.toFixed(1)}×`;
    gainSlider.style.setProperty(
      "--fill",
      String((gain - LIPSYNC_GAIN_MIN) / (LIPSYNC_GAIN_MAX - LIPSYNC_GAIN_MIN)),
    );
  }

  function reflectVad(): void {
    const ms = vad.get().silenceMs;
    vadSlider.value = String(ms);
    vadValue.textContent = `${ms} ms`;
    vadSlider.style.setProperty(
      "--fill",
      String((ms - VAD_SILENCE_MIN) / (VAD_SILENCE_MAX - VAD_SILENCE_MIN)),
    );
  }

  function reflectAgent(): void {
    const a = agentSettings.get();
    const idx = Math.max(0, REASONING_EFFORTS.indexOf(a.reasoning_effort));
    segButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    segEl.style.setProperty("--seg", String(idx));
    // 입력 중인 textarea는 덮어쓰지 않는다(원격 변경은 blur 시 적용).
    if (document.activeElement !== instructionsEl && instructionsEl.value !== a.instructions) {
      instructionsEl.value = a.instructions;
    }
  }

  // 생각중 추임새 섹션 — store 상태를 UI에 반영한다.
  function reflectFiller(): void {
    if (
      !fillerSettings ||
      !fillerSwitchBtn ||
      !fillerLangSegEl ||
      !fillerFirstTextareaEl ||
      !fillerRepeatTextareaEl
    )
      return;
    const s = fillerSettings.get();
    fillerSwitchBtn.setAttribute("aria-checked", String(s.enabled));
    // 언어 seg 인디케이터
    const FILLER_LANGS = ["ja", "en", "ko"] as const;
    const idx = Math.max(0, FILLER_LANGS.indexOf(s.language));
    fillerLangBtns.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    fillerLangSegEl.style.setProperty("--seg", String(idx));
    // 두 textarea — 현재 언어의 customPool(first/repeat)을 줄 단위로 표시(미설정 시 빈 값).
    const pool = s.customPools[s.language];
    fillerFirstTextareaEl.value = pool ? pool.first.join("\n") : "";
    fillerRepeatTextareaEl.value = pool ? pool.repeat.join("\n") : "";
  }

  // 언어 피커 — 현재 표시 언어를 선택 세그로 반영한다.
  function reflectLanguage(): void {
    const idx = Math.max(0, LANG_PICKER_ORDER.indexOf(getLocale()));
    langSegButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    langSegEl.style.setProperty("--seg", String(idx));
  }

  // 효과적 음성 엔진 — 유효한 오버라이드가 있으면 그것, 없으면 bundled 기본값, 최종 폴백 irodori.
  function effectiveProvider(): VoiceEngine {
    const ov = endpointsSettings.get().tts_provider;
    if (ov === "irodori" || ov === "openai") return ov;
    const def = getDefaultProvider?.();
    return def === "openai" ? "openai" : "irodori";
  }

  // TTS 드롭다운 값 + irodori/openai 서브뷰 표시 + 화자 활성/비활성을 효과적 provider에 맞춰 그린다.
  function reflectVoiceEngine(): void {
    const eff = effectiveProvider();
    if (ttsTypeEl.value !== eff) ttsTypeEl.value = eff;
    const openai = eff === "openai";
    ttsIrodoriEl.hidden = openai;
    ttsOpenaiEl.hidden = !openai;
    ttsSummaryHintEl.textContent = t(VOICE_ENGINE_LABEL_KEYS[eff]);
    // openai는 서버 voice로 말하므로 화자 선택을 비활성 + 안내한다(화자는 irodori 서브뷰 안).
    spkScrollEl.classList.toggle("is-disabled", openai);
    spkFootEl.classList.toggle("is-disabled", openai);
    spksHintEl.hidden = !openai;
  }

  // URL 필드 한 칸의 invalid 상태(빈 값=에러 아님)를 토글한다.
  function validateEndpointInput(key: keyof EndpointOverrides, input: HTMLInputElement): void {
    const def = ENDPOINT_FIELDS.find((f) => f.key === key)!;
    if (!def.url) return;
    const invalid = !isValidEndpointUrl(input.value);
    const row = input.closest<HTMLDivElement>(".yui-input-row")!;
    row.classList.toggle("is-invalid", invalid);
    input.setAttribute("aria-invalid", invalid ? "true" : "false");
  }

  function reflectEndpoints(): void {
    const ov = endpointsSettings.get();
    // placeholder는 config 로드 후에야 채워지므로(패널은 그 전에 생성됨) 매 reflect마다 갱신한다.
    const defaults = getEndpointDefaults?.();
    for (const { key } of ENDPOINT_FIELDS) {
      const input = epInputs.get(key)!;
      if (defaults) input.placeholder = defaults[key];
      // 입력 중인 칸은 덮어쓰지 않는다(원격 변경은 blur 시 적용).
      if (document.activeElement !== input && input.value !== ov[key]) {
        input.value = ov[key];
      }
      validateEndpointInput(key, input);
    }
  }

  // 서비스별 키 행을 모두 store에서 그린다(chat/stt/tts). 값은 시크릿 — 로깅하지 않는다.
  function reflectKeyRows(): void {
    for (const r of keyRows) r.reflect();
  }

  // 세션 진단 readout을 store에서 그린다. contextWindow가 null이면 막대·퍼센트 없이 사용량만.
  function reflectSession(): void {
    if (!sessionDiagnostics || !sessionValueEl) return;
    const d = sessionDiagnostics.get();

    // 컨텍스트 사용량 + 슬림 막대.
    const used = d.usedTokens;
    const max = d.contextWindow;
    sessionValueEl.textContent = "";
    if (used === null) {
      sessionValueEl.textContent = "—";
    } else if (max === null || max <= 0) {
      sessionValueEl.textContent = formatTokenCount(used);
    } else {
      const pct = Math.min(100, Math.round((used / max) * 100));
      sessionValueEl.append(`${formatTokenCount(used)} / ${formatTokenCount(max)}`);
      const pctEl = document.createElement("span");
      pctEl.className = "pct";
      pctEl.textContent = `${pct}%`;
      sessionValueEl.append(pctEl);
    }
    // 막대는 contextWindow를 알 때만 그린다.
    const hasMeter = used !== null && max !== null && max > 0;
    let meter = sessionStatEl?.querySelector<HTMLDivElement>(".yui-meter") ?? null;
    if (hasMeter) {
      const pct = Math.min(100, Math.round((used! / max!) * 100));
      if (!meter) {
        meter = document.createElement("div");
        meter.className = "yui-meter";
        meter.innerHTML = `<div class="yui-meter__fill"></div>`;
        sessionStatEl?.append(meter);
      }
      const fill = meter.querySelector<HTMLDivElement>(".yui-meter__fill")!;
      fill.style.width = `${pct}%`;
      fill.classList.toggle("is-high", pct >= 85);
    } else if (meter) {
      meter.remove();
    }
  }

  function reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void {
    const on = snapshot.state !== "idle";
    voiceSwitchBtn.setAttribute("aria-checked", String(on));
    el.classList.toggle("is-voice-on", on);
  }

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

  // ── 위치 계산 (popover variant) ──

  function clampToViewport(x: number, y: number): { x: number; y: number } {
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - VIEWPORT_MARGIN) nx = vw - VIEWPORT_MARGIN - rect.width;
    if (nx < VIEWPORT_MARGIN) nx = VIEWPORT_MARGIN;
    if (ny + rect.height > vh - VIEWPORT_MARGIN) ny = vh - VIEWPORT_MARGIN - rect.height;
    if (ny < VIEWPORT_MARGIN) ny = VIEWPORT_MARGIN;
    return { x: nx, y: ny };
  }

  function placeAt(x: number, y: number): void {
    el.style.removeProperty("bottom");
    el.style.transform = "";
    const c = clampToViewport(x, y);
    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
  }

  function placeFallback(): void {
    el.style.removeProperty("left");
    el.style.removeProperty("top");
    el.style.left = "50%";
    el.style.bottom = "9%";
    el.style.transform = "translate(-50%, 0)";
  }

  function positionPopover(anchor?: { x: number; y: number }): void {
    // 우선순위: 저장 위치 > 커서 앵커 > 중앙 하단 fallback.
    const saved = loadSavedPos();
    if (saved) {
      placeAt(saved.x, saved.y);
      return;
    }
    if (anchor) {
      // 앵커 아래에 열되, 아래 공간이 없으면 위로(기존 동작 보존).
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      let y = anchor.y;
      if (y + rect.height > vh - VIEWPORT_MARGIN) y = anchor.y - rect.height;
      placeAt(anchor.x, y);
      return;
    }
    placeFallback();
  }

  // ── 드래그 (popover variant) ──

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginLeft = 0;
  let dragOriginTop = 0;

  function handleBarPointerDown(e: PointerEvent): void {
    if (isWindow) return;
    if (e.button !== 0) return;
    // 헤더의 버튼(팝아웃·닫기) 클릭은 드래그로 취급하지 않는다.
    if ((e.target as HTMLElement).closest(".yui-iconbtn")) return;
    dragging = true;
    // 도킹 중에는 left/top을 수치로 직접 제어하므로 그 값을 출발점으로 삼는다.
    // (스타일 미설정 시에만 레이아웃 rect로 폴백.)
    const styleLeft = parseFloat(el.style.left);
    const styleTop = parseFloat(el.style.top);
    if (Number.isFinite(styleLeft) && Number.isFinite(styleTop)) {
      dragOriginLeft = styleLeft;
      dragOriginTop = styleTop;
    } else {
      const rect = el.getBoundingClientRect();
      dragOriginLeft = rect.left;
      dragOriginTop = rect.top;
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    barEl?.classList.add("is-dragging");
    document.addEventListener("pointermove", handleDocPointerMove);
    document.addEventListener("pointerup", handleDocPointerUp);
  }

  function handleDocPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    placeAt(dragOriginLeft + dx, dragOriginTop + dy);
  }

  function handleDocPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    barEl?.classList.remove("is-dragging");
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
    const x = parseFloat(el.style.left);
    const y = parseFloat(el.style.top);
    if (Number.isFinite(x) && Number.isFinite(y)) savePos({ x, y });
  }

  // ── open / close ──

  function open(anchor?: { x: number; y: number }): void {
    if (openState) return;
    openState = true;

    if (closeRafId !== null) {
      cancelAnimationFrame(closeRafId);
      closeRafId = null;
    }

    if (!isWindow) mount.appendChild(scrimEl);
    mount.appendChild(el);

    reflectSettings();
    reflectIdleThrottle();
    reflectTts();
    reflectGaze();
    reflectVoiceStatus(voiceStatus.get());
    reflectGain();
    reflectVad();
    reflectAgent();
    reflectFiller();
    reflectLanguage();
    reflectEndpoints();
    reflectKeyRows();
    reflectVoiceEngine();
    reflectSession();
    vrmList.render();
    speakerList.render();

    if (isWindow) {
      // 창 variant는 OS 창을 채운다 — 위치 계산/애니메이션 없음.
      el.classList.add("is-open");
    } else {
      positionPopover(anchor);
    }

    if (settings.get().enabled && !monitorsLoaded) {
      void loadMonitors();
    }

    if (!isWindow) {
      requestAnimationFrame(() => {
        el.classList.add("is-open");
      });
    }
  }

  function close(): void {
    if (!openState) return;
    if (gainPreviewing) {
      onGainPreviewEnd();
      gainPreviewing = false;
    }
    speakerList.stopAudition();
    for (const r of keyRows) r.commitIfDirty();
    openState = false;

    if (isWindow) {
      // 창 variant는 항상 보이므로 DOM에서 떼지 않는다.
      return;
    }

    el.classList.remove("is-open");

    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      el.removeEventListener("transitionend", onEnd);
      if (!el.classList.contains("is-open")) {
        el.remove();
        scrimEl.remove();
      }
    };
    el.addEventListener("transitionend", onEnd);

    closeRafId = requestAnimationFrame(() => {
      closeRafId = null;
      if (!openState && !el.classList.contains("is-open")) {
        el.remove();
        scrimEl.remove();
      }
    });
  }

  function isOpen(): boolean {
    return openState;
  }

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

  function handleGazeSwitchClick(): void {
    if (!gazeSettings) return;
    const current = gazeSettings.get().enabled;
    gazeSettings.setEnabled(!current);
    log.info("gaze_toggle", { enabled: !current });
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

  function handleFillerLangClick(e: MouseEvent): void {
    if (!fillerSettings) return;
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    const lang = btn.dataset.lang as "ja" | "en" | "ko" | undefined;
    if (!lang) return;
    fillerSettings.setLanguage(lang);
    // 언어가 바뀌면 두 textarea를 새 언어의 pool로 즉시 갱신(store 구독보다 선행).
    const pool = fillerSettings.get().customPools[lang];
    if (fillerFirstTextareaEl) fillerFirstTextareaEl.value = pool ? pool.first.join("\n") : "";
    if (fillerRepeatTextareaEl) fillerRepeatTextareaEl.value = pool ? pool.repeat.join("\n") : "";
  }

  // 언어 피커 — 세그 클릭 시 표시 언어를 바꾼다. 호스트가 i18n.subscribe로 패널을 재마운트한다.
  function handleLangSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    const locale = btn.dataset.locale as Locale | undefined;
    if (!locale) return;
    log.info("ui_language_change", { locale });
    setLocale(locale);
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
    return effectiveProvider() === "irodori";
  }

  function handleScrimPointerDown(e: PointerEvent): void {
    e.stopPropagation();
    close();
  }

  function handleDocKeydown(e: KeyboardEvent): void {
    if (isWindow) return;
    if (!openState) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
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
    // store 구독으로 reflectAgent가 시각/aria를 갱신한다.
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
    // store 구독(unsubscribeEndpoints)이 reflectVoiceEngine으로 값/서브뷰/화자 비활성을 갱신한다.
  }

  // ── 대화 섹션: 지침 textarea ──

  function handleInstructionsInput(): void {
    agentSettings.setInstructions(instructionsEl.value);
    log.info("instructions_change", { length: instructionsEl.value.length });
  }

  // blur 시점에 입력 중 보류된 원격 변경을 반영한다.
  function handleInstructionsBlur(): void {
    reflectAgent();
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
    reflectEndpoints();
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
    hideSessionConfirm();
    log.info("session_reset");
  }

  // ── 게인 슬라이더 ──

  function handleGainInput(): void {
    const v = parseFloat(gainSlider.value);
    lipsync.setGain(v); // 값 변경 시 lipsync 구독이 reflectGain으로 게인 행을 다시 그린다
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
    vad.setSilenceMs(ms); // store 구독이 reflectVad로 값 행을 다시 그린다
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
    if (!openState) return;
    switchBtn.setAttribute("aria-checked", String(s.enabled));
    el.classList.toggle("is-on", s.enabled);
    if (s.enabled && !monitorsLoaded) {
      void loadMonitors();
    }
  });
  const unsubscribeIdleThrottle = idleThrottleSettings.subscribe(() => {
    if (openState) reflectIdleThrottle();
  });
  const unsubscribeTts = ttsSettings?.subscribe(() => {
    if (openState) reflectTts();
  });
  const unsubscribeGaze = gazeSettings?.subscribe(() => {
    if (openState) reflectGaze();
  });
  // 큐 목록 컴포넌트 — 입력 탭 내 .yui-cue-sections에 마운트. 구독·teardown을 컴포넌트 자체가 관리한다.
  const scheduleDividerEl = document.createElement("div");
  scheduleDividerEl.className = "yui-quick__divider";
  scheduleDividerEl.setAttribute("aria-hidden", "true");

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
    cueSectionsMountEl.appendChild(scheduleDividerEl);
    proactiveCueList = createCueList({
      mount: cueSectionsMountEl,
      store: proactiveSettings,
      title: t("cue.proactive_title"),
      sub: t("cue.proactive_sub"),
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: t("cue.proactive_add"),
    });
  }

  mountCueLists();

  const unsubscribeVoice = voiceStatus.subscribe(reflectVoiceStatus);
  const unsubscribeLipsync = lipsync.subscribe(() => {
    if (openState) reflectGain();
  });
  const unsubscribeVad = vad.subscribe(() => {
    if (openState) reflectVad();
  });
  const unsubscribeAgent = agentSettings.subscribe(() => {
    if (openState) reflectAgent();
  });
  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (openState) {
      reflectEndpoints();
      reflectVoiceEngine();
    }
  });
  // 키 store 갱신(이 창 편집·다른 창 reloadFromStorage)을 각 행에 반영. 값은 시크릿.
  const unsubscribeKeyRows = keyRows.map((r) => r.subscribe());
  // 생각중 추임새 store 갱신을 섹션에 반영(다른 창 reloadFromStorage 포함).
  const unsubscribeFiller = fillerSettings?.subscribe(() => {
    if (openState) reflectFiller();
  });
  // store 갱신(직접 select·다른 창 reloadFromStorage)을 active 행에 반영.
  // 스왑 진행 중엔 건너뛴다 — finally의 renderVrms가 로딩 해제 후 최종 그림을 맡는다.
  const unsubscribeVrm = vrmSelection.subscribe(() => {
    if (openState && !vrmList.isSwapping()) vrmList.render();
  });
  // 화자 store 갱신(직접 select·다른 창 reloadFromStorage)을 active 행에 반영.
  // 스왑 진행 중엔 건너뛴다 — finally의 renderSpeakers가 로딩 해제 후 최종 그림을 맡는다.
  const unsubscribeSpk = speakerSelection.subscribe(() => {
    if (openState && !speakerList.isSwapping()) speakerList.render();
  });
  // 세션 진단 갱신(이 창의 reset·펫 창 reloadFromStorage)을 readout에 반영.
  const unsubscribeSession = sessionDiagnostics?.subscribe(() => {
    if (openState) reflectSession();
  });

  switchBtn.addEventListener("click", handleSwitchClick);
  idleThrottleSwitchBtn.addEventListener("click", handleIdleThrottleSwitchClick);
  ttsSwitchBtn?.addEventListener("click", handleTtsSwitchClick);
  gazeSwitchBtn?.addEventListener("click", handleGazeSwitchClick);
  fillerSwitchBtn?.addEventListener("click", handleFillerSwitchClick);
  fillerLangSegEl?.addEventListener("click", handleFillerLangClick);
  langSegEl.addEventListener("click", handleLangSegClick);
  fillerFirstTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  fillerRepeatTextareaEl?.addEventListener("input", handleFillerTextareaInput);
  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);
  scrimEl.addEventListener("pointerdown", handleScrimPointerDown);
  document.addEventListener("keydown", handleDocKeydown);
  gainSlider.addEventListener("input", handleGainInput);
  gainSlider.addEventListener("pointerup", handleGainEnd);
  gainSlider.addEventListener("blur", handleGainEnd);
  vadSlider.addEventListener("input", handleVadInput);
  vadSlider.addEventListener("pointerup", handleVadEnd);
  vadSlider.addEventListener("blur", handleVadEnd);
  tablistEl.addEventListener("click", handleTabClick);
  tablistEl.addEventListener("keydown", handleTabKeydown);
  segEl.addEventListener("click", handleSegClick);
  segEl.addEventListener("keydown", handleSegKeydown);
  ttsTypeEl.addEventListener("change", handleTtsTypeChange);
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
  barEl?.addEventListener("pointerdown", handleBarPointerDown);
  popOutBtn?.addEventListener("click", handlePopOut);
  closeBtn?.addEventListener("click", close);
  // 창 variant는 항상 보이므로 즉시 연다.
  if (isWindow) open();

  function dispose(): void {
    disposed = true;
    for (const r of keyRows) r.commitIfDirty();
    scheduleCueList?.destroy();
    proactiveCueList?.destroy();
    unsubscribe();
    unsubscribeIdleThrottle();
    unsubscribeTts?.();
    unsubscribeGaze?.();
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
    switchBtn.removeEventListener("click", handleSwitchClick);
    idleThrottleSwitchBtn.removeEventListener("click", handleIdleThrottleSwitchClick);
    ttsSwitchBtn?.removeEventListener("click", handleTtsSwitchClick);
    gazeSwitchBtn?.removeEventListener("click", handleGazeSwitchClick);
    fillerSwitchBtn?.removeEventListener("click", handleFillerSwitchClick);
    fillerLangSegEl?.removeEventListener("click", handleFillerLangClick);
    langSegEl.removeEventListener("click", handleLangSegClick);
    fillerFirstTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    fillerRepeatTextareaEl?.removeEventListener("input", handleFillerTextareaInput);
    voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
    scrimEl.removeEventListener("pointerdown", handleScrimPointerDown);
    document.removeEventListener("keydown", handleDocKeydown);
    gainSlider.removeEventListener("input", handleGainInput);
    gainSlider.removeEventListener("pointerup", handleGainEnd);
    gainSlider.removeEventListener("blur", handleGainEnd);
    vadSlider.removeEventListener("input", handleVadInput);
    vadSlider.removeEventListener("pointerup", handleVadEnd);
    vadSlider.removeEventListener("blur", handleVadEnd);
    tablistEl.removeEventListener("click", handleTabClick);
    tablistEl.removeEventListener("keydown", handleTabKeydown);
    segEl.removeEventListener("click", handleSegClick);
    segEl.removeEventListener("keydown", handleSegKeydown);
    ttsTypeEl.removeEventListener("change", handleTtsTypeChange);
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
    barEl?.removeEventListener("pointerdown", handleBarPointerDown);
    popOutBtn?.removeEventListener("click", handlePopOut);
    closeBtn?.removeEventListener("click", close);
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
    el.remove();
    scrimEl.remove();
  }

  return { el, open, close, isOpen, dispose };
}
