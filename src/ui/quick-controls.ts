/**
 * Quick-controls 패널 — 우클릭으로 소환되는 설정 패널.
 * 드래그 가능한 헤더 + 스크롤 본문(대화 · 입력 소스 · 표현 섹션)으로 구성된다.
 * variant: "popover"(기본, 펫 창 안 도킹 + 드래그) | "window"(별도 OS 창, 풀 채움).
 */

import "./quick-controls.css";
import { createLogger } from "../logger";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import type { ScreenSourceProvider, MonitorInfo } from "../io/screen-source-provider";
import type { ScreenSource } from "../contract";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "./voice-input-status";
import { createLipsyncSettings, LIPSYNC_GAIN_MIN, LIPSYNC_GAIN_MAX } from "../io/lipsync-settings";
import {
  createAgentSettings,
  INSTRUCTIONS_MAX_LEN,
  REASONING_EFFORTS,
  type ReasoningEffort,
} from "../io/agent-settings";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;
type AgentSettingsStore = ReturnType<typeof createAgentSettings>;

interface QuickControlsOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  sourceProvider: ScreenSourceProvider;
  voiceStatus: VoiceInputStatus;
  lipsync: LipsyncSettingsStore;
  agentSettings: AgentSettingsStore;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
  onPopOut?: () => void;
  variant?: "popover" | "window";
  /** 빈 instructions일 때 placeholder로 보여줄 기본 지침(config.chat_instructions). */
  getDefaultInstructions?: () => string | undefined;
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

export const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

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
  sourceProvider,
  voiceStatus,
  lipsync,
  agentSettings,
  onGainPreview,
  onGainPreviewEnd,
  onPopOut,
  variant = "popover",
  getDefaultInstructions,
}: QuickControlsOptions): QuickControls {
  const isWindow = variant === "window";
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
    <div class="yui-quick__body">
      <span class="yui-quick__section">대화</span>
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

      <div class="yui-quick__divider" aria-hidden="true"></div>

      <span class="yui-quick__section">입력 소스</span>
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
      <details class="yui-voice-details" open>
        <summary>세부 설정</summary>
        <div class="yui-voice-details__body">
          <div class="yui-voice-status">
            <span class="yui-voice-status__label">상태 표시</span>
            <span class="yui-voice-status__value">화면 위 chip</span>
          </div>
          <p class="yui-voice-status__note">Idle, 듣는 중, ASR 전송, 전달됨, 오류는 설정값이 아니라 화면 위 runtime indicator로 표시한다.</p>
          <div class="yui-setting-grid">
            <span>침묵 기준</span>
            <strong>1500 ms</strong>
            <span>STT endpoint</span>
            <strong>configs/endpoints.json</strong>
          </div>
        </div>
      </details>

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
    <p class="yui-quick__foot yui-quick__foot--on">켜져 있는 동안 매 대화에 이 화면이 첨부돼요.</p>
    <p class="yui-quick__foot yui-quick__foot--off">기본은 꺼져 있어요. 켜면 화면을 함께 보내요.</p>
  `;

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-switch")!;
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const monitorsEl = el.querySelector<HTMLDivElement>(".yui-monitors")!;
  const gainSlider = el.querySelector<HTMLInputElement>(".yui-gain__slider")!;
  const gainValue = el.querySelector<HTMLSpanElement>(".yui-gain__value")!;
  const barEl = el.querySelector<HTMLDivElement>(".yui-quick__bar")!;
  const popOutBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--popout");
  const closeBtn = el.querySelector<HTMLButtonElement>(".yui-iconbtn--close");
  const segEl = el.querySelector<HTMLDivElement>(".yui-seg")!;
  const segButtons = Array.from(el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;

  gainSlider.min = String(LIPSYNC_GAIN_MIN);
  gainSlider.max = String(LIPSYNC_GAIN_MAX);
  gainSlider.step = "0.1";

  // 기본 지침 placeholder.
  const defaultInstr = getDefaultInstructions?.();
  instructionsEl.placeholder = defaultInstr && defaultInstr.length > 0 ? defaultInstr : "기본 지침을 사용 중이에요";

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

  function reflectGain(): void {
    const gain = lipsync.get().gain;
    gainSlider.value = String(gain);
    gainValue.textContent = gain.toFixed(1) + "×";
    gainSlider.style.setProperty("--fill", String((gain - LIPSYNC_GAIN_MIN) / (LIPSYNC_GAIN_MAX - LIPSYNC_GAIN_MIN)));
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
    reflectVoiceStatus(voiceStatus.get());
    reflectGain();
    reflectAgent();

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

  // ── 게인 슬라이더 ──

  function handleGainInput(): void {
    const v = parseFloat(gainSlider.value);
    lipsync.setGain(v);
    gainPreviewing = true;
    onGainPreview(previewMouth(v));
    reflectGain();
  }

  function handleGainEnd(): void {
    if (gainPreviewing) { onGainPreviewEnd(); gainPreviewing = false; }
    log.info("입 움직임 변경", { gain: parseFloat(gainSlider.value) });
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
  const unsubscribeVoice = voiceStatus.subscribe(reflectVoiceStatus);
  const unsubscribeLipsync = lipsync.subscribe(() => { if (openState) reflectGain(); });
  const unsubscribeAgent = agentSettings.subscribe(() => { if (openState) reflectAgent(); });

  switchBtn.addEventListener("click", handleSwitchClick);
  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);
  scrimEl.addEventListener("pointerdown", handleScrimPointerDown);
  document.addEventListener("keydown", handleDocKeydown);
  gainSlider.addEventListener("input", handleGainInput);
  gainSlider.addEventListener("pointerup", handleGainEnd);
  gainSlider.addEventListener("blur", handleGainEnd);
  segEl.addEventListener("click", handleSegClick);
  segEl.addEventListener("keydown", handleSegKeydown);
  instructionsEl.addEventListener("input", handleInstructionsInput);
  instructionsEl.addEventListener("blur", handleInstructionsBlur);
  resetBtn.addEventListener("click", handleResetInstructions);
  barEl.addEventListener("pointerdown", handleBarPointerDown);
  popOutBtn?.addEventListener("click", handlePopOut);
  closeBtn?.addEventListener("click", close);

  // 창 variant는 항상 보이므로 즉시 연다.
  if (isWindow) open();

  function dispose(): void {
    unsubscribe();
    unsubscribeVoice();
    unsubscribeLipsync();
    unsubscribeAgent();
    switchBtn.removeEventListener("click", handleSwitchClick);
    voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
    scrimEl.removeEventListener("pointerdown", handleScrimPointerDown);
    document.removeEventListener("keydown", handleDocKeydown);
    gainSlider.removeEventListener("input", handleGainInput);
    gainSlider.removeEventListener("pointerup", handleGainEnd);
    gainSlider.removeEventListener("blur", handleGainEnd);
    segEl.removeEventListener("click", handleSegClick);
    segEl.removeEventListener("keydown", handleSegKeydown);
    instructionsEl.removeEventListener("input", handleInstructionsInput);
    instructionsEl.removeEventListener("blur", handleInstructionsBlur);
    resetBtn.removeEventListener("click", handleResetInstructions);
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
