/**
 * Quick-controls 패널 — 우클릭으로 소환되는 설정 패널.
 * 드래그 가능한 헤더 + 탭 스트립(대화 · 캐릭터 · 입력 · 고급) + 탭 패널 본문으로 구성된다.
 * variant: "popover"(기본, 펫 창 안 도킹 + 드래그) | "window"(별도 OS 창, 풀 채움).
 */

import "./quick-controls.css";
import { createLogger } from "../logger";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import type { createProactiveSettings } from "../io/proactive-settings";
import type { ScreenSourceProvider, MonitorInfo } from "../io/screen-source-provider";
import type { ScreenSource } from "../contract";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "./voice-input-status";
import type { createVrmSelection } from "../io/vrm-selection";
import type { createSpeakerSelection, SpeakerOption } from "../io/speaker-selection";
import type { AvatarOption } from "../config/load";
import { createLipsyncSettings, LIPSYNC_GAIN_MIN, LIPSYNC_GAIN_MAX } from "../io/lipsync-settings";
import { createVadSettings, VAD_SILENCE_MIN, VAD_SILENCE_MAX } from "../io/vad-settings";
import {
  createAgentSettings,
  INSTRUCTIONS_MAX_LEN,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "../io/agent-settings";
import {
  createEndpointsSettings,
  isValidEndpointUrl,
  type EndpointOverrides,
} from "../io/endpoints-settings";
import type { createSessionDiagnosticsStore } from "../io/session-diagnostics";
import type { createSessionStore } from "../io/session-store";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type ProactiveSettingsStore = ReturnType<typeof createProactiveSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type VadSettingsStore = ReturnType<typeof createVadSettings>;
type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;
type VrmSelectionStore = ReturnType<typeof createVrmSelection>;
type SpeakerSelectionStore = ReturnType<typeof createSpeakerSelection>;
type SessionDiagnosticsStore = ReturnType<typeof createSessionDiagnosticsStore>;
type SessionStore = ReturnType<typeof createSessionStore>;

interface QuickControlsOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  /** proactive 발화 on/off store. 끄면 firing만 게이팅, 소스 구독은 유지된다. */
  proactiveSettings: ProactiveSettingsStore;
  sourceProvider: ScreenSourceProvider;
  voiceStatus: VoiceInputStatus;
  lipsync: LipsyncSettingsStore;
  /** STT 침묵 기준(ms) 단일값 store. 입력 탭의 슬라이더가 구동한다. */
  vad: VadSettingsStore;
  agentSettings: AgentSettingsStore;
  vrmSelection: VrmSelectionStore;
  /** 실제 스왑 수행 + 성공 시 store 커밋. 컴포넌트는 store.select를 직접 호출하지 않는다. */
  swapVrm: (option: AvatarOption) => Promise<void>;
  speakerSelection: SpeakerSelectionStore;
  /** 실제 화자 스왑 수행 + 성공 시 store 커밋. 컴포넌트는 store.select를 직접 호출하지 않는다. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** 화자의 참조 음성 재등록(PUT /voices). 서버 측 갱신만 — 화자 선택/store는 바꾸지 않는다. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  onPopOut?: () => void;
  variant?: "popover" | "window";
  /** 빈 instructions일 때 placeholder로 보여줄 기본 지침(config.chat_instructions). */
  getDefaultInstructions?: () => string | undefined;
  /** 사용자 편집 엔드포인트 오버라이드 store. 빈 값=폴백. */
  endpointsSettings: EndpointsSettingsStore;
  /** placeholder로 보여줄 bundled config 기본 엔드포인트(미로드 시 undefined). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** 오버라이드가 없을 때 음성 엔진 세그가 반영할 bundled config 기본 provider(미로드 시 undefined). */
  getDefaultProvider?: () => "openai" | "irodori" | undefined;
  /** 세션 진단(컨텍스트 사용량·마지막 압축). window variant에서만 세션 섹션을 그린다. */
  sessionDiagnostics?: SessionDiagnosticsStore;
  /** 현재 세션 id 포인터. "새 대화 시작"이 진단과 함께 비운다. */
  sessionStore?: SessionStore;
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

const SEG_LABELS: Record<ReasoningEffort, string> = {
  default: "기본값",
  low: "Low",
  medium: "Medium",
  high: "High",
};

// 엔드포인트 섹션: 편집 가능한 5개 필드. url=true면 isValidEndpointUrl 라이브 검증.
interface EndpointFieldDef {
  key: keyof EndpointOverrides;
  label: string;
  url: boolean;
}
const ENDPOINT_FIELDS: readonly EndpointFieldDef[] = [
  { key: "chat_base_url", label: "채팅 서버 URL", url: true },
  { key: "stt_base_url", label: "음성 인식(STT) 서버 URL", url: true },
  { key: "tts_base_url", label: "음성 합성(TTS) 서버 URL", url: true },
  { key: "irodori_base_url", label: "irodori 서버 URL", url: true },
  { key: "broker_base_url", label: "표현 브로커(Broker) URL", url: true },
  { key: "chat_model", label: "채팅 모델", url: false },
];
const ENDPOINT_URL_ERROR = "올바른 URL이 아니에요 (http:// 또는 https://)";

// 음성 엔진 세그먼트(2칸) — tts_provider 오버라이드를 구동. 효과적 provider를 반영한다.
const VOICE_ENGINES = ["irodori", "openai"] as const;
type VoiceEngine = (typeof VOICE_ENGINES)[number];
const VOICE_ENGINE_LABELS: Record<VoiceEngine, string> = {
  irodori: "irodori",
  openai: "OpenAI 호환",
};
const SPEAKER_OPENAI_HINT =
  "irodori 전용이에요. OpenAI 호환 엔진은 서버에 설정된 voice로 말해요.";

export const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

// 토큰 수를 "18.2K" / "18K" / "200K" 꼴로 줄여 표기한다. 1000 미만은 그대로,
// 100K 미만은 소수 1자리(다만 .0은 떼고), 이상은 정수.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return Math.round(k) + "K";
  return k.toFixed(1).replace(/\.0$/, "") + "K";
}

// 과거 ISO 시각을 현재 기준 상대 표현으로. just now / N minutes ago / N hours ago / N days ago.
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const sec = Math.max(0, Math.round((now - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
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
  proactiveSettings,
  sourceProvider,
  voiceStatus,
  lipsync,
  vad,
  agentSettings,
  vrmSelection,
  swapVrm,
  speakerSelection,
  swapSpeaker,
  refreshSpeaker,
  onGainPreview,
  onGainPreviewEnd,
  onPopOut,
  variant = "popover",
  getDefaultInstructions,
  endpointsSettings,
  getEndpointDefaults,
  getDefaultProvider,
  sessionDiagnostics,
  sessionStore,
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
  el.setAttribute("aria-label", "설정");

  const segButtonsHtml = REASONING_EFFORTS.map(
    (e) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-effort="${e}" aria-checked="false" tabindex="-1">${SEG_LABELS[e]}</button>`,
  ).join("");

  const voiceEngineButtonsHtml = VOICE_ENGINES.map(
    (p) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-provider="${p}" aria-checked="false" tabindex="-1">${VOICE_ENGINE_LABELS[p]}</button>`,
  ).join("");

  // 엔드포인트 필드 행. 라벨/placeholder/value는 빈 채로 두고 reflectEndpoints가 채운다.
  // type="text"로 두고 검증 메시지를 직접 제어한다(브라우저 기본 URL 검증 회피).
  const endpointRowsHtml = ENDPOINT_FIELDS.map(({ key, label, url }) => {
    const errId = `yui-ep-err-${key}`;
    const urlClass = url ? " yui-ep-input--url" : "";
    const errHtml = url
      ? `<p class="yui-input-row__error" id="${errId}" role="status">${ENDPOINT_URL_ERROR}</p>`
      : "";
    return `
          <div class="yui-input-row" data-ep-field="${key}">
            <label class="yui-input-row__label" for="yui-ep-${key}">${label}</label>
            <span class="yui-input-row__sub">비우면 기본값을 사용해요</span>
            <div class="yui-input-wrap">
              <input class="yui-ep-input${urlClass}" id="yui-ep-${key}" type="text" spellcheck="false"
                inputmode="${url ? "url" : "text"}" autocapitalize="off" autocomplete="off" />
            </div>
            ${errHtml}
          </div>`;
  }).join("");

  // 세션 섹션(window 전용). compacting/disabled 상태는 의도적으로 구현하지 않는다 —
  // dispatcher의 compacting 상태는 창 간 전파되지 않고, reset은 펫 창 thunk가 이미 race-safe.
  const sessionHtml = hasSession
    ? `
      <div class="yui-quick__divider" aria-hidden="true"></div>
      <span class="yui-quick__section">세션 · Session</span>
      <div class="yui-session">
        <div class="yui-session__stat">
          <div class="yui-session__statline">
            <span class="yui-session__label">Context</span>
            <span class="yui-session__value"></span>
          </div>
        </div>
        <div class="yui-session__grid">
          <span class="k">Last compression</span>
          <span class="yui-session__last"></span>
          <span class="yui-session__when-k">When</span>
          <span class="yui-session__when-v v"></span>
        </div>
        <div class="yui-quick__divider" aria-hidden="true"></div>
        <div class="yui-session__action">
          <span class="yui-session__action-label">새 대화 시작 · Start fresh</span>
          <span class="yui-session__action-sub">Start a new conversation. YUI keeps the current memory until you do.</span>
        </div>
        <button class="yui-link-btn yui-session__reset" type="button">대화 초기화 · Reset conversation</button>
        <div class="yui-confirm" hidden>
          <span class="yui-confirm__q">Start over?</span>
          <button class="yui-pill yui-pill--go yui-session__confirm" type="button">Start fresh</button>
          <button class="yui-pill yui-session__cancel" type="button">Cancel</button>
        </div>
      </div>`
    : "";

  const headerHtml = isWindow
    ? `
    <div class="yui-quick__bar">
      <span class="yui-quick__title">설정</span>
    </div>`
    : `
    <div class="yui-quick__bar" title="드래그해서 옮기기">
      <span class="yui-quick__grip" aria-hidden="true">
        <i></i><i></i><i></i><i></i><i></i><i></i>
      </span>
      <span class="yui-quick__title">설정</span>
      <span class="yui-quick__bar-actions">
        <button class="yui-iconbtn yui-iconbtn--popout" type="button" aria-label="창으로 빼기" title="창으로 빼기">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M14 5h5v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M19 5l-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18 13v4a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
        <button class="yui-iconbtn yui-iconbtn--close" type="button" aria-label="닫기" title="닫기">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </button>
      </span>
    </div>`;

  el.innerHTML = `
    ${headerHtml}
    <div class="yui-tabs" role="tablist" aria-label="설정 영역" style="--tab:0;">
      <span class="yui-tabs__ind" aria-hidden="true"></span>
      <button class="yui-tab" type="button" role="tab" id="yui-tab-talk" aria-selected="true" aria-controls="yui-panel-talk" tabindex="0">대화</button>
      <button class="yui-tab" type="button" role="tab" id="yui-tab-char" aria-selected="false" aria-controls="yui-panel-char" tabindex="-1">캐릭터</button>
      <button class="yui-tab" type="button" role="tab" id="yui-tab-input" aria-selected="false" aria-controls="yui-panel-input" tabindex="-1">입력</button>
      <button class="yui-tab" type="button" role="tab" id="yui-tab-adv" aria-selected="false" aria-controls="yui-panel-adv" tabindex="-1">고급</button>
    </div>
    <div class="yui-quick__body">

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-talk" aria-labelledby="yui-tab-talk" tabindex="0">
        <div class="yui-field-row">
          <span class="yui-field-row__label">추론 강도</span>
          <span class="yui-field-row__sub">답변 전 얼마나 깊게 생각할지</span>
          <div class="yui-seg" role="radiogroup" aria-label="추론 강도" style="--seg:0;">
            <span class="yui-seg__ind" aria-hidden="true"></span>
            ${segButtonsHtml}
          </div>
        </div>
        <div class="yui-field-row">
          <span class="yui-field-row__label">지침</span>
          <span class="yui-field-row__sub">비우면 기본 지침을 사용해요</span>
          <div class="yui-textarea-wrap">
            <textarea class="yui-textarea" spellcheck="false" rows="4" maxlength="${INSTRUCTIONS_MAX_LEN}" aria-label="지침"></textarea>
          </div>
          <button class="yui-reset" type="button">기본값으로 되돌리기</button>
        </div>
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-char" aria-labelledby="yui-tab-char" tabindex="0" hidden>
        <span class="yui-quick__section">VRM</span>
        <div class="yui-vrm-scroll">
          <div class="yui-vrms" role="radiogroup" aria-label="VRM"></div>
        </div>
        <div class="yui-vrm-foot">
          <button class="yui-vrm yui-vrm--add" type="button" disabled aria-disabled="true" tabindex="-1">
            <span class="yui-vrm__tick" aria-hidden="true"></span>
            <span class="yui-vrm__body"><span class="yui-vrm__name">파일에서 추가…</span></span>
            <span class="yui-vrm__soon">준비 중</span>
          </button>
        </div>

        <div class="yui-quick__divider" aria-hidden="true"></div>

        <span class="yui-quick__section">화자 · 音声</span>
        <div class="yui-field-row">
          <span class="yui-field-row__label">음성 엔진</span>
          <span class="yui-field-row__sub">목소리를 합성하는 방식</span>
          <div class="yui-seg yui-seg--2" role="radiogroup" aria-label="음성 엔진" style="--seg:0;">
            <span class="yui-seg__ind" aria-hidden="true"></span>
            ${voiceEngineButtonsHtml}
          </div>
        </div>
        <div class="yui-spk-scroll">
          <div class="yui-spks" role="radiogroup" aria-label="화자"></div>
        </div>
        <div class="yui-spk-foot">
          <button class="yui-spk yui-spk--add" type="button" disabled aria-disabled="true" tabindex="-1">
            <span class="yui-spk__tick" aria-hidden="true"></span>
            <span class="yui-spk__body"><span class="yui-spk__name">파일에서 추가…</span></span>
            <span class="yui-spk__soon">준비 중</span>
          </button>
        </div>
        <p class="yui-spks-hint" role="status" hidden>${SPEAKER_OPENAI_HINT}</p>

        <div class="yui-quick__divider" aria-hidden="true"></div>

        <span class="yui-quick__section">표현</span>
        <div class="yui-gain">
          <div class="yui-gain__head">
            <span class="yui-gain__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 10c2.4-2.4 4.9-3.6 8-3.6s5.6 1.2 8 3.6c-2.4 1.1-4.9 1.7-8 1.7s-5.6-.6-8-1.7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M4 14c2.4 2.4 4.9 3.6 8 3.6s5.6-1.2 8-3.6c-2.4-1.1-4.9-1.7-8-1.7s-5.6.6-8 1.7Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              </svg>
              입 움직임
            </span>
            <span class="yui-gain__value">2.0×</span>
          </div>
          <span class="yui-gain__sub">목소리 크기에 따라 입이 벌어지는 정도</span>
          <input class="yui-gain__slider" type="range" aria-label="입 움직임" />
          <span class="yui-gain__hint">드래그하면 캐릭터 입이 실제로 그만큼 벌어져요</span>
        </div>
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-input" aria-labelledby="yui-tab-input" tabindex="0" hidden>
        <div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 3.5l1.6 3.9 3.9 1.6-3.9 1.6L12 14.5l-1.6-3.9L6.5 9l3.9-1.6L12 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M18.5 15l.7 1.7 1.8.7-1.8.7-.7 1.7-.7-1.7-1.8-.7 1.8-.7.7-1.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
              </svg>
              주도적 반응
            </span>
            <span class="yui-row__sub">다른 앱을 쓸 때도 가끔 먼저 말을 걸어요</span>
          </div>
          <button class="yui-switch yui-proactive-switch" type="button" role="switch" aria-checked="false" aria-label="주도적 반응"></button>
        </div>
        <div class="yui-row">
          <div class="yui-row__main">
            <span class="yui-row__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5" width="18" height="13" rx="2" stroke="currentColor" stroke-width="1.7"/>
                <path d="M3 9h18" stroke="currentColor" stroke-width="1.7"/>
              </svg>
              스크린샷 첨부
            </span>
            <span class="yui-row__sub">대화할 때 화면을 함께 봐요</span>
          </div>
          <button class="yui-switch" type="button" role="switch" aria-checked="false" aria-label="스크린샷 첨부"></button>
        </div>
        <div class="yui-source">
          <div class="yui-source__label">보낼 화면</div>
          <div class="yui-monitors" role="radiogroup" aria-label="보낼 화면"></div>
        </div>
        <div class="yui-row yui-row--voice">
          <div class="yui-row__main">
            <span class="yui-row__label">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 4.5v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M12 15.5v3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                <path d="M9.5 18.5h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              음성 입력
            </span>
            <span class="yui-row__sub">말이 끝나면 STT 후 사용자 입력으로 보내요</span>
          </div>
          <button class="yui-switch yui-voice-switch" type="button" role="switch" aria-checked="false" aria-label="음성 입력"></button>
        </div>
        <div class="yui-gain">
          <div class="yui-gain__head">
            <span class="yui-gain__label">침묵 기준</span>
            <span class="yui-gain__value yui-vad__value">1500 ms</span>
          </div>
          <span class="yui-gain__sub">말이 끝난 뒤 이만큼 기다렸다가 전송해요</span>
          <input class="yui-gain__slider yui-vad__slider" type="range" aria-label="침묵 기준" />
        </div>
      </div>

      <div class="yui-tabpanel" role="tabpanel" id="yui-panel-adv" aria-labelledby="yui-tab-adv" tabindex="0" hidden>
        <span class="yui-quick__section">엔드포인트</span>
        <details class="yui-endpoints">
          <summary>
            <span>엔드포인트</span>
            <span class="yui-endpoints__hint">고급 — 서버 주소·모델</span>
          </summary>
          <div class="yui-endpoints__body">
            ${endpointRowsHtml}
            <button class="yui-reset yui-endpoints__reset yui-ep-reset" type="button">기본값으로 되돌리기</button>
          </div>
        </details>
        ${sessionHtml}
      </div>

    </div>
    <p class="yui-quick__foot yui-quick__foot--on">켜져 있는 동안 매 대화에 이 화면이 첨부돼요.</p>
    <p class="yui-quick__foot yui-quick__foot--off">기본은 꺼져 있어요. 켜면 화면을 함께 보내요.</p>
  `;

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-switch[aria-label='스크린샷 첨부']")!;
  const proactiveSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-proactive-switch")!;
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const monitorsEl = el.querySelector<HTMLDivElement>(".yui-monitors")!;
  const vrmsEl = el.querySelector<HTMLDivElement>(".yui-vrms")!;
  const spksEl = el.querySelector<HTMLDivElement>(".yui-spks")!;
  const gainSlider = el.querySelector<HTMLInputElement>(".yui-gain__slider:not(.yui-vad__slider)")!;
  const gainValue = el.querySelector<HTMLSpanElement>(".yui-gain__value:not(.yui-vad__value)")!;
  const vadSlider = el.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const vadValue = el.querySelector<HTMLSpanElement>(".yui-vad__value")!;
  const tablistEl = el.querySelector<HTMLDivElement>(".yui-tabs")!;
  const tabButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-tab"));
  const barEl = el.querySelector<HTMLDivElement>(".yui-quick__bar")!;
  const popOutBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");
  const segEl = el.querySelector<HTMLDivElement>(".yui-field-row .yui-seg:not(.yui-seg--2)")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  // 음성 엔진 세그(2칸) + 화자 비활성 노드(캐릭터 탭).
  const voiceSegEl = el.querySelector<HTMLDivElement>(".yui-seg--2")!;
  const voiceSegButtons = Array.from(voiceSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const spkScrollEl = el.querySelector<HTMLDivElement>(".yui-spk-scroll")!;
  const spkFootEl = el.querySelector<HTMLDivElement>(".yui-spk-foot")!;
  const spksHintEl = el.querySelector<HTMLParagraphElement>(".yui-spks-hint")!;
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;
  const epResetBtn = el.querySelector<HTMLButtonElement>(".yui-ep-reset")!;
  // 엔드포인트 입력 — 필드 key별 input 노드 맵.
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    epInputs.set(key, el.querySelector<HTMLInputElement>(`#yui-ep-${key}`)!);
  }

  // 세션 섹션 노드(window 전용 — 없으면 null).
  const sessionStatEl = el.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = el.querySelector<HTMLSpanElement>(".yui-session__value");
  const sessionLastEl = el.querySelector<HTMLSpanElement>(".yui-session__last");
  const sessionWhenKEl = el.querySelector<HTMLSpanElement>(".yui-session__when-k");
  const sessionWhenVEl = el.querySelector<HTMLSpanElement>(".yui-session__when-v");
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
  instructionsEl.placeholder = defaultInstr && defaultInstr.length > 0 ? defaultInstr : "기본 지침을 사용 중이에요";

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

  // ── DOM 동기화 ──

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    el.classList.toggle("is-on", on);
  }

  function reflectProactive(): void {
    proactiveSwitchBtn.setAttribute("aria-checked", String(proactiveSettings.get().enabled));
  }

  function reflectGain(): void {
    const gain = lipsync.get().gain;
    gainSlider.value = String(gain);
    gainValue.textContent = gain.toFixed(1) + "×";
    gainSlider.style.setProperty("--fill", String((gain - LIPSYNC_GAIN_MIN) / (LIPSYNC_GAIN_MAX - LIPSYNC_GAIN_MIN)));
  }

  function reflectVad(): void {
    const ms = vad.get().silenceMs;
    vadSlider.value = String(ms);
    vadValue.textContent = `${ms} ms`;
    vadSlider.style.setProperty("--fill", String((ms - VAD_SILENCE_MIN) / (VAD_SILENCE_MAX - VAD_SILENCE_MIN)));
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

  // 효과적 음성 엔진 — 유효한 오버라이드가 있으면 그것, 없으면 bundled 기본값, 최종 폴백 irodori.
  function effectiveProvider(): VoiceEngine {
    const ov = endpointsSettings.get().tts_provider;
    if (ov === "irodori" || ov === "openai") return ov;
    const def = getDefaultProvider?.();
    return def === "openai" ? "openai" : "irodori";
  }

  // 음성 엔진 세그 + 화자 목록 활성/비활성을 효과적 provider에 맞춰 그린다.
  function reflectVoiceEngine(): void {
    const eff = effectiveProvider();
    const idx = VOICE_ENGINES.indexOf(eff);
    voiceSegButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    voiceSegEl.style.setProperty("--seg", String(Math.max(0, idx)));
    // openai는 서버 voice로 말하므로 화자 선택을 비활성 + 안내한다.
    const openai = eff === "openai";
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

    // 마지막 압축 — 없으면 muted placeholder, 있으면 before → after (N) + 상대시간.
    const lc = d.lastCompression;
    if (!sessionLastEl) return;
    if (lc === null) {
      sessionLastEl.className = "yui-session__empty";
      sessionLastEl.textContent = "No compression yet";
      if (sessionWhenKEl) sessionWhenKEl.hidden = true;
      if (sessionWhenVEl) {
        sessionWhenVEl.className = "yui-session__when-v";
        sessionWhenVEl.hidden = true;
        sessionWhenVEl.textContent = "";
      }
    } else {
      sessionLastEl.className = "v";
      sessionLastEl.textContent = "";
      sessionLastEl.append(formatTokenCount(lc.beforeTokens));
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = "→";
      const after = document.createTextNode(formatTokenCount(lc.afterTokens));
      const removed = document.createElement("span");
      removed.className = "removed";
      removed.textContent = `${lc.removed} messages removed`;
      sessionLastEl.append(arrow, after, removed);
      if (sessionWhenKEl) sessionWhenKEl.hidden = false;
      if (sessionWhenVEl) {
        sessionWhenVEl.className = "yui-session__when-v v";
        sessionWhenVEl.hidden = false;
        sessionWhenVEl.textContent = formatRelativeTime(lc.at);
      }
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
      const selected =
        currentSource.kind === "monitor" && currentSource.index === mon.index;
      btn.setAttribute("aria-checked", String(selected));
      btn.className = "yui-mon";

      const metaText =
        mon.width !== undefined && mon.height !== undefined
          ? `${mon.width} × ${mon.height}`
          : "";
      const badgeHtml = mon.primary
        ? `<span class="yui-mon__badge">주 화면</span>`
        : "";

      btn.innerHTML = `
        <span class="yui-mon__tick" aria-hidden="true"></span>
        <span class="yui-mon__body">
          <span class="yui-mon__name">디스플레이 ${mon.index + 1}</span>
          ${metaText ? `<span class="yui-mon__meta">${metaText}</span>` : ""}
        </span>
        ${badgeHtml}
      `;

      btn.addEventListener("click", () => {
        const label = mon.label ?? `디스플레이 ${mon.index + 1}`;
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

  // 스왑 진행 중인 id(중복 스왑 가드) · 직전 오류 행 id(다시 그릴 때 인라인 안내 유지).
  let vrmSwapping: string | null = null;
  let vrmErrorId: string | null = null;
  // 마지막으로 화살표가 머문 행 id — 재그림이 roving tabindex를 active로 되돌리지 않게 유지.
  // close()에서 일부러 리셋하지 않는다 — 재오픈 시에도 머문 행을 잇고, ids.includes로 가드한다.
  let vrmRovedId: string | null = null;

  function renderVrms(): void {
    const activeId = vrmSelection.getActiveId();
    // roving tabindex는 마지막으로 화살표가 머문 행이 우선 — 없으면 active로 폴백.
    const ids = vrmSelection.list().map((o) => o.id);
    const rovedId = vrmRovedId !== null && ids.includes(vrmRovedId) ? vrmRovedId : activeId;
    // innerHTML 재그림이 포커스를 가진 행을 파괴한다 — 가졌던 경우에만 복원하려고 미리 기록.
    const hadFocus = vrmsEl.contains(document.activeElement);
    vrmsEl.innerHTML = "";
    for (const opt of vrmSelection.list()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "radio");
      btn.className = "yui-vrm";
      btn.dataset.vrmId = opt.id;
      const selected = opt.id === activeId;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = opt.id === rovedId ? 0 : -1;

      const badgeHtml = selected ? `<span class="yui-vrm__badge">사용 중</span>` : "";
      btn.innerHTML = `
        <span class="yui-vrm__tick" aria-hidden="true"></span>
        <span class="yui-vrm__body"><span class="yui-vrm__name"></span></span>
        ${badgeHtml}
      `;
      // 라벨은 신뢰 불가 입력일 수 있다 — textContent로만 넣는다.
      btn.querySelector<HTMLSpanElement>(".yui-vrm__name")!.textContent = opt.label;

      btn.addEventListener("click", () => {
        void swapTo(opt);
      });

      vrmsEl.appendChild(btn);

      // 직전 오류 행이면 비활성으로 다시 그린 뒤 인라인 안내를 그 아래에 붙인다.
      if (opt.id === vrmErrorId) {
        btn.classList.add("is-error");
        btn.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-vrm__error";
        err.setAttribute("role", "status");
        err.textContent = "이 모델을 불러오지 못했어요. 이전 모델로 되돌렸어요.";
        vrmsEl.appendChild(err);
      }
    }

    // 재그림 전 라디오그룹이 포커스를 쥐고 있었다면 roving 행으로 포커스를 잇는다.
    if (hadFocus) {
      const roved = vrmRowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  function vrmRowById(id: string): HTMLButtonElement | null {
    return vrmsEl.querySelector<HTMLButtonElement>(`.yui-vrm[data-vrm-id="${CSS.escape(id)}"]`);
  }

  async function swapTo(option: AvatarOption): Promise<void> {
    if (vrmSwapping !== null) return; // 진행 중엔 두 번째 스왑 금지
    if (option.id === vrmSelection.getActiveId()) return; // 이미 active면 no-op

    // 직전 오류 표시가 있으면 그것만 먼저 지운다(목록 재그림으로 인라인 안내 제거).
    if (vrmErrorId !== null) {
      vrmErrorId = null;
      renderVrms();
    }
    vrmSwapping = option.id;

    // 로딩 반영: 클릭 행에 "바꾸는 중…" + 스피너, 그룹은 busy로 잠근다.
    // 행을 in-place로 변형해 호출부가 쥔 노드 참조를 유지한다(재그림 안 함).
    vrmsEl.setAttribute("aria-busy", "true");
    vrmsEl.classList.add("is-swapping");
    const row = vrmRowById(option.id);
    if (row) {
      row.setAttribute("aria-busy", "true");
      const body = row.querySelector(".yui-vrm__body");
      if (body && !row.querySelector(".yui-vrm__hint")) {
        const hint = document.createElement("span");
        hint.className = "yui-vrm__hint";
        hint.textContent = "바꾸는 중…";
        body.insertAdjacentElement("afterend", hint);
      }
    }

    try {
      await swapVrm(option);
      vrmRovedId = option.id; // 커밋된 행으로 roving tabindex를 잇는다
      log.info("VRM 스왑", { id: option.id });
      // 성공: swapVrm이 store를 커밋했고 구독이 active 행을 옮긴다. 잠금 해제 후 재그림.
    } catch (err) {
      vrmErrorId = option.id;
      log.error("VRM 스왑 실패", { id: option.id, error: String(err) });
      // 실패: 선택은 그대로(revert는 store가 바뀌지 않아 자동). 오류 행 + 인라인 안내.
    } finally {
      vrmSwapping = null;
      vrmsEl.removeAttribute("aria-busy");
      vrmsEl.classList.remove("is-swapping");
      renderVrms();
    }
  }

  // VRM radiogroup 키보드 — 화자 섹션과 동일한 manual-activation.
  // Enter/Space는 선택(스왑), 화살표는 roving focus 이동만(래핑), Home/End는 양끝.
  function handleVrmKeydown(e: KeyboardEvent): void {
    if (vrmSwapping !== null) return;
    const target = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-vrm[role=radio]");
    if (!target) return;
    const rows = Array.from(vrmsEl.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = vrmSelection.list().find((o) => o.id === target.dataset.vrmId);
      if (opt) void swapTo(opt);
      return;
    }

    const current = Math.max(0, rows.indexOf(target));
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const wrapped = (next + rows.length) % rows.length;
    const focusTarget = rows[wrapped];
    vrmRovedId = focusTarget.dataset.vrmId ?? null;
    for (const r of rows) r.tabIndex = -1;
    focusTarget.tabIndex = 0;
    focusTarget.focus();
    focusTarget.scrollIntoView?.({ block: "nearest" });
  }

  // ── 화자 섹션 ──
  // VRM 섹션을 미러링하되 한 가지만 다르다: 행이 <button>이 아닌 div[role=radio]다
  // (중첩 ▶ 미리듣기 <button>을 품으려면 — button 안의 button은 무효 HTML이라 파서가 빼낸다).
  // 그래서 roving tabindex/Enter·Space/화살표 키보드를 직접 배선한다.

  const SPK_PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
  const SPK_PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.4" height="12" rx="0.8"/><rect x="13.6" y="6" width="3.4" height="12" rx="0.8"/></svg>`;
  const SPK_REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-1.6 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 5v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const SPK_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const SPK_NOTE_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  let spkSwapping: string | null = null;
  let spkErrorId: string | null = null;
  // 마지막으로 화살표가 머문 행 id — 재그림이 roving tabindex를 active로 되돌리지 않게 유지.
  // close()에서 일부러 리셋하지 않는다 — 재오픈 시에도 머문 행을 잇고, ids.includes로 가드한다.
  let spkRovedId: string | null = null;

  // 행별 참조-음성 갱신 상태 — renderSpeakers 재그림을 살아남도록 id별로 보관.
  type RefreshState = "refreshing" | "done" | "error";
  const spkRefreshState = new Map<string, RefreshState>();
  // "done" 상태를 일정 시간 후 idle로 되돌리는 타이머(중복 갱신·dispose 시 정리).
  const spkRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // dispose 후 in-flight refresh가 무너진 DOM에 재그림/타이머를 쓰지 않게 막는다.
  let disposed = false;
  const REFRESH_DONE_DWELL_MS = 2400;

  function clearRefreshTimer(id: string): void {
    const t = spkRefreshTimers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      spkRefreshTimers.delete(id);
    }
  }

  // 미리듣기는 단일 audition — 하나를 재생하면 다른 것은 멈춘다.
  let auditionAudio: HTMLAudioElement | null = null;
  let auditionBtn: HTMLButtonElement | null = null;

  function stopAudition(): void {
    if (auditionAudio) {
      auditionAudio.pause();
      auditionAudio = null;
    }
    if (auditionBtn) {
      auditionBtn.classList.remove("is-playing");
      auditionBtn.innerHTML = SPK_PLAY_SVG;
      auditionBtn = null;
    }
  }

  function toggleAudition(btn: HTMLButtonElement, refUrl: string): void {
    if (auditionBtn === btn) {
      stopAudition(); // 같은 버튼 재클릭 → 정지 토글
      return;
    }
    stopAudition(); // 다른 클립 재생 중이면 먼저 멈춘다
    const audio = new Audio(refUrl);
    audio.addEventListener("ended", () => {
      if (auditionBtn === btn) stopAudition();
    });
    auditionAudio = audio;
    auditionBtn = btn;
    btn.classList.add("is-playing");
    btn.innerHTML = SPK_PAUSE_SVG;
    // play()는 Promise 또는(구형/일부 환경) undefined를 반환할 수 있다 — 둘 다 안전 처리.
    const fail = (): void => {
      if (auditionBtn === btn) stopAudition();
    };
    try {
      const p = audio.play();
      if (p && typeof p.then === "function") p.catch(fail);
    } catch {
      fail();
    }
  }

  function renderSpeakers(): void {
    const activeId = speakerSelection.getActiveId();
    // roving tabindex는 마지막으로 화살표가 머문 행이 우선 — 없으면 active로 폴백.
    const ids = speakerSelection.list().map((o) => o.id);
    const rovedId = spkRovedId !== null && ids.includes(spkRovedId) ? spkRovedId : activeId;
    const hadFocus = spksEl.contains(document.activeElement);
    stopAudition(); // 재그림이 미리듣기 버튼 노드를 파괴하므로 audition 정리
    spksEl.innerHTML = "";
    for (const opt of speakerSelection.list()) {
      const row = document.createElement("div");
      row.setAttribute("role", "radio");
      row.className = "yui-spk";
      row.dataset.spkId = opt.id;
      const selected = opt.id === activeId;
      row.setAttribute("aria-checked", String(selected));
      row.tabIndex = opt.id === rovedId ? 0 : -1;

      const label = opt.label ?? opt.id;
      const hasClip = opt.ref_url.length > 0;
      const refreshState = spkRefreshState.get(opt.id);
      const badgeHtml = selected ? `<span class="yui-spk__badge">사용 중</span>` : "";
      row.innerHTML = `
        <span class="yui-spk__tick" aria-hidden="true"></span>
        <span class="yui-spk__body"><span class="yui-spk__name"></span></span>
        <button class="yui-spk__refresh" type="button" title="참조 음성 갱신" ${hasClip ? "" : "disabled"}>${SPK_REFRESH_SVG}</button>
        <button class="yui-spk__preview" type="button" title="미리듣기" ${hasClip ? "" : "disabled"}>${SPK_PLAY_SVG}</button>
        ${badgeHtml}
      `;
      // 라벨은 신뢰 불가 입력일 수 있다 — textContent로만 넣는다.
      const nameEl = row.querySelector<HTMLSpanElement>(".yui-spk__name")!;
      nameEl.textContent = label;
      const refreshBtn = row.querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
      refreshBtn.setAttribute("aria-label", `${label} 참조 음성 갱신`);
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // 갱신은 행 선택을 트리거하지 않는다
        if (hasClip) void refreshTo(opt);
      });
      const previewBtn = row.querySelector<HTMLButtonElement>(".yui-spk__preview")!;
      previewBtn.setAttribute("aria-label", `${label} 미리듣기`);
      previewBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // 미리듣기는 행 선택을 트리거하지 않는다
        if (hasClip) toggleAudition(previewBtn, opt.ref_url);
      });

      row.addEventListener("click", () => {
        void swapToSpeaker(opt);
      });

      // 저장된 refresh 상태를 재그림 후에도 시각/aria에 반영한다.
      if (refreshState === "refreshing") {
        refreshBtn.classList.add("is-refreshing");
        refreshBtn.disabled = true;
        refreshBtn.setAttribute("aria-label", `${label} 참조 음성 갱신 중`);
        const body = row.querySelector(".yui-spk__body");
        if (body && !row.querySelector(".yui-spk__hint")) {
          const hint = document.createElement("span");
          hint.className = "yui-spk__hint";
          hint.textContent = "갱신 중…";
          body.insertAdjacentElement("afterend", hint);
        }
      } else if (refreshState === "done") {
        refreshBtn.classList.add("is-done");
        refreshBtn.innerHTML = SPK_CHECK_SVG;
        refreshBtn.setAttribute("aria-label", `${label} 참조 음성 갱신됨`);
      }

      spksEl.appendChild(row);

      if (opt.id === spkErrorId) {
        row.classList.add("is-error");
        row.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-spk__error";
        err.setAttribute("role", "status");
        err.textContent = "이 화자를 불러오지 못했어요. 이전 화자로 되돌렸어요.";
        spksEl.appendChild(err);
      } else if (refreshState === "error") {
        row.classList.add("is-error");
        row.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-spk__error";
        err.setAttribute("role", "status");
        err.textContent = "참조 음성을 갱신하지 못했어요.";
        spksEl.appendChild(err);
      } else if (refreshState === "done") {
        const note = document.createElement("p");
        note.className = "yui-spk__note";
        note.setAttribute("role", "status");
        note.innerHTML = `${SPK_NOTE_CHECK_SVG}참조 음성을 갱신했어요.`;
        spksEl.appendChild(note);
      }
    }

    if (hadFocus) {
      const roved = spkRowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  function spkRowById(id: string): HTMLDivElement | null {
    return spksEl.querySelector<HTMLDivElement>(`.yui-spk[data-spk-id="${CSS.escape(id)}"]`);
  }

  async function swapToSpeaker(option: SpeakerOption): Promise<void> {
    if (spkSwapping !== null) return; // 진행 중엔 두 번째 스왑 금지
    if (option.id === speakerSelection.getActiveId()) return; // 이미 active면 no-op

    if (spkErrorId !== null) {
      spkErrorId = null;
      renderSpeakers();
    }
    spkSwapping = option.id;

    spksEl.setAttribute("aria-busy", "true");
    spksEl.classList.add("is-swapping");
    const row = spkRowById(option.id);
    if (row) {
      row.setAttribute("aria-busy", "true");
      // 미리듣기 버튼은 스왑 중 숨기고 "바꾸는 중…" 힌트를 그 자리에 둔다.
      row.querySelector(".yui-spk__preview")?.remove();
      const body = row.querySelector(".yui-spk__body");
      if (body && !row.querySelector(".yui-spk__hint")) {
        const hint = document.createElement("span");
        hint.className = "yui-spk__hint";
        hint.textContent = "바꾸는 중…";
        body.insertAdjacentElement("afterend", hint);
      }
    }

    try {
      await swapSpeaker(option);
      spkRovedId = option.id; // 커밋된 행으로 roving tabindex를 잇는다
      log.info("화자 스왑", { id: option.id });
    } catch (err) {
      spkErrorId = option.id;
      log.error("화자 스왑 실패", { id: option.id, error: String(err) });
    } finally {
      spkSwapping = null;
      spksEl.removeAttribute("aria-busy");
      spksEl.classList.remove("is-swapping");
      renderSpeakers();
    }
  }

  // 참조 음성 재등록 — 서버 측 갱신만, 화자 선택/store는 바꾸지 않는다.
  // 재진입 가드: 같은 id가 이미 갱신 중이면 무시한다.
  async function refreshTo(option: SpeakerOption): Promise<void> {
    if (spkRefreshState.get(option.id) === "refreshing") return;
    clearRefreshTimer(option.id);
    spkRefreshState.set(option.id, "refreshing");
    renderSpeakers();
    try {
      await refreshSpeaker(option);
      if (disposed) return;
      spkRefreshState.set(option.id, "done");
      log.info("참조 음성 갱신", { id: option.id });
      renderSpeakers();
      // 일정 시간 후 idle로 되돌린다(상태 삭제 + 재그림).
      spkRefreshTimers.set(
        option.id,
        setTimeout(() => {
          spkRefreshTimers.delete(option.id);
          spkRefreshState.delete(option.id);
          renderSpeakers();
        }, REFRESH_DONE_DWELL_MS),
      );
    } catch (err) {
      if (disposed) return;
      spkRefreshState.set(option.id, "error");
      log.error("참조 음성 갱신 실패", { id: option.id, error: String(err) });
      renderSpeakers();
    }
  }

  // 화자 radiogroup 키보드 — div[role=radio]라 직접 배선한다.
  // manual-activation: 화살표는 roving focus 이동만, Enter/Space가 커밋 — 매 화살표마다 ▶ 미리듣기/스왑 비용을 피한다.
  function handleSpkKeydown(e: KeyboardEvent): void {
    if (spkSwapping !== null) return;
    const target = (e.target as HTMLElement).closest<HTMLDivElement>(".yui-spk[role=radio]");
    if (!target) return;
    const rows = Array.from(spksEl.querySelectorAll<HTMLDivElement>(".yui-spk[role=radio]"));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = speakerSelection.list().find((o) => o.id === target.dataset.spkId);
      if (opt) void swapToSpeaker(opt);
      return;
    }

    const current = Math.max(0, rows.indexOf(target));
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const wrapped = (next + rows.length) % rows.length;
    const focusTarget = rows[wrapped];
    spkRovedId = focusTarget.dataset.spkId ?? null;
    // roving tabindex 이동: 새 행만 0, 나머지 -1.
    for (const r of rows) r.tabIndex = -1;
    focusTarget.tabIndex = 0;
    focusTarget.focus();
    focusTarget.scrollIntoView?.({ block: "nearest" });
  }

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
    barEl.classList.add("is-dragging");
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
    barEl.classList.remove("is-dragging");
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
    reflectProactive();
    reflectVoiceStatus(voiceStatus.get());
    reflectGain();
    reflectVad();
    reflectAgent();
    reflectEndpoints();
    reflectVoiceEngine();
    reflectSession();
    renderVrms();
    renderSpeakers();

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
    if (gainPreviewing) { onGainPreviewEnd(); gainPreviewing = false; }
    stopAudition();
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
    log.info("스크린샷 첨부", { enabled: !current });
    if (!current && !monitorsLoaded) {
      void loadMonitors();
    }
  }

  function handleProactiveSwitchClick(): void {
    const current = proactiveSettings.get().enabled;
    proactiveSettings.setEnabled(!current);
    log.info("주도적 반응", { enabled: !current });
  }

  function handleVoiceSwitchClick(): void {
    const current = voiceStatus.get().state !== "idle";
    log.info("음성 입력 토글", { on: !current });
    voiceStatus.set(current ? "idle" : "listening");
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
    log.info("추론 강도 변경", { effort });
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

  // ── 캐릭터 섹션: 음성 엔진(tts_provider) 세그먼트 ──

  function selectVoiceEngine(index: number, focus = false): void {
    const clamped = Math.min(VOICE_ENGINES.length - 1, Math.max(0, index));
    const provider = VOICE_ENGINES[clamped];
    endpointsSettings.set({ tts_provider: provider });
    log.info("음성 엔진 변경", { provider });
    // store 구독(unsubscribeEndpoints)이 reflectVoiceEngine으로 시각/aria/화자 비활성을 갱신한다.
    if (focus) voiceSegButtons[clamped]?.focus();
  }

  function handleVoiceSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    selectVoiceEngine(voiceSegButtons.indexOf(btn));
  }

  function handleVoiceSegKeydown(e: KeyboardEvent): void {
    const current = voiceSegButtons.findIndex((b) => b.getAttribute("aria-checked") === "true");
    const base = current < 0 ? 0 : current;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      selectVoiceEngine(base + 1, true);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      selectVoiceEngine(base - 1, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      selectVoiceEngine(0, true);
    } else if (e.key === "End") {
      e.preventDefault();
      selectVoiceEngine(VOICE_ENGINES.length - 1, true);
    }
  }

  // ── 대화 섹션: 지침 textarea ──

  function handleInstructionsInput(): void {
    agentSettings.setInstructions(instructionsEl.value);
    log.info("지침 변경", { length: instructionsEl.value.length });
  }

  // blur 시점에 입력 중 보류된 원격 변경을 반영한다.
  function handleInstructionsBlur(): void {
    reflectAgent();
  }

  function handleResetInstructions(): void {
    agentSettings.setInstructions("");
    instructionsEl.value = "";
    log.info("지침 초기화");
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

  function handleResetEndpoints(): void {
    endpointsSettings.reset();
    for (const { key } of ENDPOINT_FIELDS) {
      const input = epInputs.get(key)!;
      input.value = "";
      validateEndpointInput(key, input);
    }
    log.info("엔드포인트 초기화");
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
    log.info("세션 초기화");
  }

  // ── 게인 슬라이더 ──

  function handleGainInput(): void {
    const v = parseFloat(gainSlider.value);
    lipsync.setGain(v); // 값 변경 시 lipsync 구독이 reflectGain으로 게인 행을 다시 그린다
    gainPreviewing = true;
    onGainPreview(previewMouth(v));
  }

  function handleGainEnd(): void {
    if (gainPreviewing) { onGainPreviewEnd(); gainPreviewing = false; }
    log.info("입 움직임 변경", { gain: parseFloat(gainSlider.value) });
  }

  // ── 침묵 기준(VAD) 슬라이더 ──

  function handleVadInput(): void {
    const ms = parseInt(vadSlider.value, 10);
    vad.setSilenceMs(ms); // store 구독이 reflectVad로 값 행을 다시 그린다
  }

  function handleVadEnd(): void {
    log.info("침묵 기준 변경", { silenceMs: parseInt(vadSlider.value, 10) });
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
  const unsubscribeProactive = proactiveSettings.subscribe(() => {
    if (openState) reflectProactive();
  });
  const unsubscribeVoice = voiceStatus.subscribe(reflectVoiceStatus);
  const unsubscribeLipsync = lipsync.subscribe(() => { if (openState) reflectGain(); });
  const unsubscribeVad = vad.subscribe(() => { if (openState) reflectVad(); });
  const unsubscribeAgent = agentSettings.subscribe(() => { if (openState) reflectAgent(); });
  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
    if (openState) {
      reflectEndpoints();
      reflectVoiceEngine();
    }
  });
  // store 갱신(직접 select·다른 창 reloadFromStorage)을 active 행에 반영.
  // 스왑 진행 중엔 건너뛴다 — finally의 renderVrms가 로딩 해제 후 최종 그림을 맡는다.
  const unsubscribeVrm = vrmSelection.subscribe(() => {
    if (openState && vrmSwapping === null) renderVrms();
  });
  // 화자 store 갱신(직접 select·다른 창 reloadFromStorage)을 active 행에 반영.
  // 스왑 진행 중엔 건너뛴다 — finally의 renderSpeakers가 로딩 해제 후 최종 그림을 맡는다.
  const unsubscribeSpk = speakerSelection.subscribe(() => {
    if (openState && spkSwapping === null) renderSpeakers();
  });
  // 세션 진단 갱신(이 창의 reset·펫 창 reloadFromStorage)을 readout에 반영.
  const unsubscribeSession = sessionDiagnostics?.subscribe(() => {
    if (openState) reflectSession();
  });

  switchBtn.addEventListener("click", handleSwitchClick);
  proactiveSwitchBtn.addEventListener("click", handleProactiveSwitchClick);
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
  voiceSegEl.addEventListener("click", handleVoiceSegClick);
  voiceSegEl.addEventListener("keydown", handleVoiceSegKeydown);
  vrmsEl.addEventListener("keydown", handleVrmKeydown);
  spksEl.addEventListener("keydown", handleSpkKeydown);
  instructionsEl.addEventListener("input", handleInstructionsInput);
  instructionsEl.addEventListener("blur", handleInstructionsBlur);
  resetBtn.addEventListener("click", handleResetInstructions);
  for (const input of epInputs.values()) {
    input.addEventListener("input", handleEndpointInput);
    input.addEventListener("blur", handleEndpointBlur);
  }
  epResetBtn.addEventListener("click", handleResetEndpoints);
  sessionResetBtn?.addEventListener("click", showSessionConfirm);
  sessionConfirmBtn?.addEventListener("click", handleSessionReset);
  sessionCancelBtn?.addEventListener("click", hideSessionConfirm);
  barEl.addEventListener("pointerdown", handleBarPointerDown);
  popOutBtn?.addEventListener("click", handlePopOut);
  closeBtn?.addEventListener("click", close);

  // 창 variant는 항상 보이므로 즉시 연다.
  if (isWindow) open();

  function dispose(): void {
    disposed = true;
    unsubscribe();
    unsubscribeProactive();
    unsubscribeVoice();
    unsubscribeLipsync();
    unsubscribeVad();
    unsubscribeAgent();
    unsubscribeEndpoints();
    unsubscribeVrm();
    unsubscribeSpk();
    unsubscribeSession?.();
    stopAudition();
    for (const t of spkRefreshTimers.values()) clearTimeout(t);
    spkRefreshTimers.clear();
    spkRefreshState.clear();
    switchBtn.removeEventListener("click", handleSwitchClick);
    proactiveSwitchBtn.removeEventListener("click", handleProactiveSwitchClick);
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
    voiceSegEl.removeEventListener("click", handleVoiceSegClick);
    voiceSegEl.removeEventListener("keydown", handleVoiceSegKeydown);
    vrmsEl.removeEventListener("keydown", handleVrmKeydown);
    spksEl.removeEventListener("keydown", handleSpkKeydown);
    instructionsEl.removeEventListener("input", handleInstructionsInput);
    instructionsEl.removeEventListener("blur", handleInstructionsBlur);
    resetBtn.removeEventListener("click", handleResetInstructions);
    for (const input of epInputs.values()) {
      input.removeEventListener("input", handleEndpointInput);
      input.removeEventListener("blur", handleEndpointBlur);
    }
    epResetBtn.removeEventListener("click", handleResetEndpoints);
    sessionResetBtn?.removeEventListener("click", showSessionConfirm);
    sessionConfirmBtn?.removeEventListener("click", handleSessionReset);
    sessionCancelBtn?.removeEventListener("click", hideSessionConfirm);
    barEl.removeEventListener("pointerdown", handleBarPointerDown);
    popOutBtn?.removeEventListener("click", handlePopOut);
    closeBtn?.removeEventListener("click", close);
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
    el.remove();
    scrimEl.remove();
  }

  return { el, open, close, isOpen, dispose };
}
