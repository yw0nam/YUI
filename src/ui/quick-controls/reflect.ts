/**
 * Reflect (store→DOM 동기화) 레이어 — 패널의 모든 store 상태를 DOM에 반영한다.
 * 각 reflect 함수는 한 섹션의 store를 읽어 해당 DOM 노드(스위치·슬라이더·세그·입력·세션 readout)에 그린다.
 * DOM 노드는 deps.root에서 직접 쿼리한다(엔트리의 핸들러가 같은 노드를 쿼리해도 동일 노드라 무해).
 */

import type { createAgentNotifySettings } from "../../io/agent-notify-settings";
import { type createAgentSettings, REASONING_EFFORTS } from "../../io/agent-settings";
import {
  type createEndpointsSettings,
  type EndpointOverrides,
  isValidEndpointUrl,
} from "../../io/endpoints-settings";
import type { createFillerSettings } from "../../io/filler-settings";
import type { createGazeSettings } from "../../io/gaze-settings";
import type { createGithubSettings } from "../../io/github-settings";
import type { createIdleThrottleSettings } from "../../io/idle-throttle-settings";
import {
  type createLipsyncSettings,
  LIPSYNC_GAIN_MAX,
  LIPSYNC_GAIN_MIN,
} from "../../io/lipsync-settings";
import type { createPresenceSettings } from "../../io/presence-settings";
import type { createScreenshotSettings } from "../../io/screenshot-settings";
import type { createSessionDiagnosticsStore } from "../../io/session-diagnostics";
import type { createTtsSettings } from "../../io/tts-settings";
import { type createVadSettings, VAD_SILENCE_MAX, VAD_SILENCE_MIN } from "../../io/vad-settings";
import { getLocale, t } from "../i18n";
import type { VoiceInputStatusSnapshot } from "../voice-input-status";
import {
  CHAT_API_LABEL_KEYS,
  type ChatApi,
  ENDPOINT_FIELDS,
  LANG_PICKER_ORDER,
  VOICE_ENGINE_LABEL_KEYS,
  type VoiceEngine,
} from "./constants";

// 토큰 수를 "18.2K" / "18K" / "200K" 꼴로 줄여 표기한다. 1000 미만은 그대로,
// 100K 미만은 소수 1자리(다만 .0은 떼고), 이상은 정수.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k >= 100) return `${Math.round(k)}K`;
  return `${k.toFixed(1).replace(/\.0$/, "")}K`;
}

// URL 필드 한 칸의 invalid 상태(빈 값=에러 아님)를 토글한다. reflectEndpoints + 엔드포인트 핸들러가 공유한다.
export function validateEndpointInput(key: keyof EndpointOverrides, input: HTMLInputElement): void {
  const def = ENDPOINT_FIELDS.find((f) => f.key === key)!;
  if (!def.url) return;
  const invalid = !isValidEndpointUrl(input.value);
  const row = input.closest<HTMLDivElement>(".yui-input-row")!;
  row.classList.toggle("is-invalid", invalid);
  input.setAttribute("aria-invalid", invalid ? "true" : "false");
}

export interface ReflectDeps {
  /** 패널 루트(el) — 모든 reflect 대상 노드를 여기서 쿼리한다. */
  root: HTMLElement;
  settings: ReturnType<typeof createScreenshotSettings>;
  idleThrottleSettings: ReturnType<typeof createIdleThrottleSettings>;
  ttsSettings?: ReturnType<typeof createTtsSettings>;
  gazeSettings?: ReturnType<typeof createGazeSettings>;
  githubSettings?: ReturnType<typeof createGithubSettings>;
  agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
  lipsync: ReturnType<typeof createLipsyncSettings>;
  vad: ReturnType<typeof createVadSettings>;
  agentSettings: ReturnType<typeof createAgentSettings>;
  fillerSettings?: ReturnType<typeof createFillerSettings>;
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  sessionDiagnostics?: ReturnType<typeof createSessionDiagnosticsStore>;
  /** 서비스별 API 키 행 — reflectKeyRows가 각 행의 reflect()를 호출한다. */
  keyRows: readonly { reflect(): void }[];
  /** placeholder로 보여줄 bundled config 기본 엔드포인트(미로드 시 undefined). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** 오버라이드가 없을 때 효과적 provider가 폴백할 bundled config 기본값(미로드 시 undefined). */
  getDefaultProvider?: () => "openai" | "irodori" | undefined;
  /** 오버라이드가 없을 때 효과적 chat_api가 폴백할 bundled config 기본값(미로드 시 undefined). */
  getDefaultChatApi?: () => string | undefined;
  /** Reactions tab numeric inputs — provided when the feature is enabled. */
  githubPollInput?: HTMLInputElement;
  agentPortInput?: HTMLInputElement;
  presenceInput?: HTMLInputElement;
  presenceSettings?: ReturnType<typeof createPresenceSettings>;
}

export interface Reflect {
  reflectSettings(): void;
  reflectIdleThrottle(): void;
  reflectTts(): void;
  reflectGaze(): void;
  reflectGithub(): void;
  reflectAgentNotify(): void;
  reflectPresence(): void;
  reflectGain(): void;
  reflectVad(): void;
  reflectAgent(): void;
  reflectFiller(): void;
  reflectLanguage(): void;
  reflectVoiceEngine(): void;
  reflectChatType(): void;
  reflectEndpoints(): void;
  reflectKeyRows(): void;
  reflectSession(): void;
  reflectVoiceStatus(snapshot: VoiceInputStatusSnapshot): void;
  /** 효과적 음성 엔진(reflectVoiceEngine + 엔트리의 speakerControlsEnabled가 쓴다). */
  effectiveProvider(): VoiceEngine;
  /** 효과적 chat API(reflectChatType이 쓴다). */
  effectiveChatApi(): ChatApi;
}

export function createReflect(deps: ReflectDeps): Reflect {
  const {
    root,
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
    githubPollInput,
    agentPortInput,
    presenceInput,
    presenceSettings,
  } = deps;

  const switchBtn = root.querySelector<HTMLButtonElement>(".yui-screenshot-switch")!;
  const idleThrottleSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-idle-throttle-switch")!;
  const gazeSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-gaze-switch");
  const githubSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-github-switch");
  const agentNotifySwitchBtn = root.querySelector<HTMLButtonElement>(".yui-agentnotify-switch");
  const voiceSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const ttsSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-tts-switch");
  const gainSlider = root.querySelector<HTMLInputElement>(
    ".yui-gain__slider:not(.yui-vad__slider)",
  )!;
  const gainValue = root.querySelector<HTMLSpanElement>(".yui-gain__value:not(.yui-vad__value)")!;
  const vadSlider = root.querySelector<HTMLInputElement>(".yui-vad__slider")!;
  const vadValue = root.querySelector<HTMLSpanElement>(".yui-vad__value")!;
  const segEl = root.querySelector<HTMLDivElement>(".yui-field-row .yui-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const ttsTypeEl = root.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  const ttsIrodoriEl = root.querySelector<HTMLDivElement>(".yui-tts-irodori")!;
  const ttsOpenaiEl = root.querySelector<HTMLDivElement>(".yui-tts-openai")!;
  const ttsSummaryHintEl = root.querySelector<HTMLSpanElement>(".yui-tts-summary-hint")!;
  const chatTypeEl = root.querySelector<HTMLSelectElement>(".yui-chat-type")!;
  const chatSummaryHintEl = root.querySelector<HTMLSpanElement>(".yui-chat-summary-hint")!;
  const spkScrollEl = root.querySelector<HTMLDivElement>(".yui-spk-scroll")!;
  const spkFootEl = root.querySelector<HTMLDivElement>(".yui-spk-foot")!;
  const spksHintEl = root.querySelector<HTMLParagraphElement>(".yui-spks-hint")!;
  const instructionsEl = root.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const fillerSwitchBtn = root.querySelector<HTMLButtonElement>(".yui-filler-switch");
  const fillerLangSegEl = root.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const fillerLangBtns = fillerLangSegEl
    ? Array.from(fillerLangSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];
  const fillerFirstTextareaEl = root.querySelector<HTMLTextAreaElement>(
    ".yui-filler-first-textarea",
  );
  const fillerRepeatTextareaEl = root.querySelector<HTMLTextAreaElement>(
    ".yui-filler-repeat-textarea",
  );
  const langSegEl = root.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    epInputs.set(key, root.querySelector<HTMLInputElement>(`#yui-ep-${key}`)!);
  }
  const sessionStatEl = root.querySelector<HTMLDivElement>(".yui-session__stat");
  const sessionValueEl = root.querySelector<HTMLSpanElement>(".yui-session__value");

  function reflectSettings(): void {
    const s = settings.get();
    const on = s.enabled;
    switchBtn.setAttribute("aria-checked", String(on));
    root.classList.toggle("is-on", on);
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

  function reflectGithub(): void {
    if (!githubSwitchBtn || !githubSettings) return;
    githubSwitchBtn.setAttribute("aria-checked", String(githubSettings.get().enabled));
    if (githubPollInput)
      githubPollInput.value = String(githubSettings.get().poll_interval_ms / 1000);
  }

  function reflectAgentNotify(): void {
    if (!agentNotifySwitchBtn || !agentNotifySettings) return;
    agentNotifySwitchBtn.setAttribute("aria-checked", String(agentNotifySettings.get().enabled));
    if (agentPortInput) agentPortInput.value = String(agentNotifySettings.get().port);
  }

  function reflectPresence(): void {
    if (!presenceInput || !presenceSettings) return;
    presenceInput.value = String(presenceSettings.get().present_max_idle_ms / 1000);
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

  // 효과적 chat API — 유효한 오버라이드가 있으면 그것, 없으면 bundled 기본값, 최종 폴백 responses.
  function effectiveChatApi(): ChatApi {
    const ov = endpointsSettings.get().chat_api;
    if (ov === "responses" || ov === "chat_completions") return ov;
    const def = getDefaultChatApi?.();
    return def === "chat_completions" ? "chat_completions" : "responses";
  }

  // Chat API 드롭다운 값 + summary hint를 효과적 chat_api에 맞춰 그린다(서브뷰 없음).
  function reflectChatType(): void {
    const eff = effectiveChatApi();
    if (chatTypeEl.value !== eff) chatTypeEl.value = eff;
    chatSummaryHintEl.textContent = t(CHAT_API_LABEL_KEYS[eff]);
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
    root.classList.toggle("is-voice-on", on);
  }

  return {
    reflectSettings,
    reflectIdleThrottle,
    reflectGithub,
    reflectAgentNotify,
    reflectPresence,
    reflectTts,
    reflectGaze,
    reflectGain,
    reflectVad,
    reflectAgent,
    reflectFiller,
    reflectLanguage,
    reflectVoiceEngine,
    reflectChatType,
    reflectEndpoints,
    reflectKeyRows,
    reflectSession,
    reflectVoiceStatus,
    effectiveProvider,
    effectiveChatApi,
  };
}
