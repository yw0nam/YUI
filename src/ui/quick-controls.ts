/**
 * Quick-controls 팝오버 — 우클릭으로 소환되는 빠른 설정 패널.
 * 현재는 스크린샷 섹션만 포함. 추가 섹션은 inner container에 append한다.
 */

import "./quick-controls.css";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import type { ScreenSourceProvider, MonitorInfo } from "../io/screen-source-provider";
import type { ScreenSource } from "../contract";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "./voice-input-status";
import { createLipsyncSettings, LIPSYNC_GAIN_MIN, LIPSYNC_GAIN_MAX } from "../io/lipsync-settings";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;
type LipsyncSettingsStore = ReturnType<typeof createLipsyncSettings>;

interface QuickControlsOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  sourceProvider: ScreenSourceProvider;
  voiceStatus: VoiceInputStatus;
  lipsync: LipsyncSettingsStore;
  onGainPreview: (mouthOpen: number) => void;
  onGainPreviewEnd: () => void;
}

interface QuickControls {
  el: HTMLElement;
  open(anchor?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

const VIEWPORT_MARGIN = 12;

const PREVIEW_PEAK_RMS = 0.15;
const previewMouth = (gain: number): number => Math.min(1, Math.max(0, gain * PREVIEW_PEAK_RMS));

export function createQuickControls({
  mount,
  settings,
  sourceProvider,
  voiceStatus,
  lipsync,
  onGainPreview,
  onGainPreviewEnd,
}: QuickControlsOptions): QuickControls {
  // scrim(바깥 클릭 감지) + 팝오버를 body에 직접 붙이지 않고 mount 안에 넣는다.
  // pointer-events: auto를 직접 부여해 overlay pointer-none을 돌파.
  const scrimEl = document.createElement("div");
  scrimEl.className = "yui-quick-scrim";

  const el = document.createElement("div");
  el.className = "yui-quick";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "빠른 설정");

  el.innerHTML = `
    <span class="yui-quick__eyebrow">빠른 설정</span>
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
    <p class="yui-quick__foot yui-quick__foot--on">켜져 있는 동안 매 대화에 이 화면이 첨부돼요.</p>
    <p class="yui-quick__foot yui-quick__foot--off">기본은 꺼져 있어요. 켜면 화면을 함께 보내요.</p>
  `;

  const switchBtn = el.querySelector<HTMLButtonElement>(".yui-switch")!;
  const voiceSwitchBtn = el.querySelector<HTMLButtonElement>(".yui-voice-switch")!;
  const monitorsEl = el.querySelector<HTMLDivElement>(".yui-monitors")!;
  const gainSlider = el.querySelector<HTMLInputElement>(".yui-gain__slider")!;
  const gainValue = el.querySelector<HTMLSpanElement>(".yui-gain__value")!;

  gainSlider.min = String(LIPSYNC_GAIN_MIN);
  gainSlider.max = String(LIPSYNC_GAIN_MAX);
  gainSlider.step = "0.1";

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

  // ── 위치 계산 ──

  function positionPopover(anchor?: { x: number; y: number }): void {
    if (!anchor) {
      // fallback: 중앙 하단 (mock 기본 배치)
      el.style.removeProperty("left");
      el.style.removeProperty("top");
      el.style.left = "50%";
      el.style.bottom = "9%";
      el.style.transform = "translate(-50%, 0) scale(1)";
      return;
    }

    el.style.removeProperty("bottom");
    el.style.transform = "";

    // 팝오버를 DOM에 넣은 후 크기를 잰다
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = anchor.x;
    let y = anchor.y;

    // 오른쪽 경계 클램프
    if (x + rect.width > vw - VIEWPORT_MARGIN) {
      x = vw - VIEWPORT_MARGIN - rect.width;
    }
    // 왼쪽 경계 클램프
    if (x < VIEWPORT_MARGIN) x = VIEWPORT_MARGIN;

    // 아래 경계 클램프 (기본은 앵커 아래에 열림, 공간이 없으면 위로)
    if (y + rect.height > vh - VIEWPORT_MARGIN) {
      y = anchor.y - rect.height;
    }
    if (y < VIEWPORT_MARGIN) y = VIEWPORT_MARGIN;

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  // ── open / close ──

  function open(anchor?: { x: number; y: number }): void {
    if (openState) return;
    openState = true;

    if (closeRafId !== null) {
      cancelAnimationFrame(closeRafId);
      closeRafId = null;
    }

    // scrim → 팝오버 순으로 DOM에 삽입 (z-index 순)
    mount.appendChild(scrimEl);
    mount.appendChild(el);

    reflectSettings();
    reflectVoiceStatus(voiceStatus.get());
    reflectGain();

    // 위치 잡기 (getBoundingClientRect은 DOM 삽입 후)
    if (anchor) {
      positionPopover(anchor);
    } else {
      el.style.removeProperty("left");
      el.style.removeProperty("top");
      el.style.bottom = "9%";
      el.style.left = "50%";
    }

    // ON 상태이고 모니터 목록이 비어 있으면 로드
    if (settings.get().enabled && !monitorsLoaded) {
      void loadMonitors();
    }

    // 다음 프레임에 is-open 추가 → CSS transition 점화
    requestAnimationFrame(() => {
      el.classList.add("is-open");
    });
  }

  function close(): void {
    if (!openState) return;
    if (gainPreviewing) { onGainPreviewEnd(); gainPreviewing = false; }
    openState = false;
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

    // reduced-motion 환경에서 transitionend가 안 올 수도 있어 rAF 폴백
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
    if (!current && !monitorsLoaded) {
      // 방금 ON이 됐고 목록이 없으면 로드
      void loadMonitors();
    }
  }

  function handleVoiceSwitchClick(): void {
    const current = voiceStatus.get().state !== "idle";
    voiceStatus.set(current ? "idle" : "listening");
  }

  function handleScrimPointerDown(e: PointerEvent): void {
    // scrim이 팝오버 뒤에 있으므로 팝오버 안쪽 클릭은 scrim에 도달하지 않음
    e.stopPropagation();
    close();
  }

  function handleDocKeydown(e: KeyboardEvent): void {
    if (!openState) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  // settings 구독 → DOM 동기화
  const unsubscribe = settings.subscribe((s) => {
    if (!openState) return;
    switchBtn.setAttribute("aria-checked", String(s.enabled));
    el.classList.toggle("is-on", s.enabled);
    // ON으로 전환됐고 목록이 비어 있으면 로드
    if (s.enabled && !monitorsLoaded) {
      void loadMonitors();
    }
  });
  const unsubscribeVoice = voiceStatus.subscribe(reflectVoiceStatus);
  const unsubscribeLipsync = lipsync.subscribe(() => { if (openState) reflectGain(); });

  function handleGainInput(): void {
    const v = parseFloat(gainSlider.value);
    lipsync.setGain(v);
    gainPreviewing = true;
    onGainPreview(previewMouth(v));
    gainValue.textContent = v.toFixed(1) + "×";
    gainSlider.style.setProperty("--fill", String((v - LIPSYNC_GAIN_MIN) / (LIPSYNC_GAIN_MAX - LIPSYNC_GAIN_MIN)));
  }

  function handleGainEnd(): void {
    if (gainPreviewing) { onGainPreviewEnd(); gainPreviewing = false; }
  }

  switchBtn.addEventListener("click", handleSwitchClick);
  voiceSwitchBtn.addEventListener("click", handleVoiceSwitchClick);
  scrimEl.addEventListener("pointerdown", handleScrimPointerDown);
  document.addEventListener("keydown", handleDocKeydown);
  gainSlider.addEventListener("input", handleGainInput);
  gainSlider.addEventListener("pointerup", handleGainEnd);
  gainSlider.addEventListener("blur", handleGainEnd);

  function dispose(): void {
    unsubscribe();
    unsubscribeVoice();
    unsubscribeLipsync();
    switchBtn.removeEventListener("click", handleSwitchClick);
    voiceSwitchBtn.removeEventListener("click", handleVoiceSwitchClick);
    scrimEl.removeEventListener("pointerdown", handleScrimPointerDown);
    document.removeEventListener("keydown", handleDocKeydown);
    gainSlider.removeEventListener("input", handleGainInput);
    gainSlider.removeEventListener("pointerup", handleGainEnd);
    gainSlider.removeEventListener("blur", handleGainEnd);
    el.remove();
    scrimEl.remove();
  }

  return { el, open, close, isOpen, dispose };
}
