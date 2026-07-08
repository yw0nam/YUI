/**
 * Capture indicator — R7 항상-ON 프라이버시 tell.
 * 스크린샷이 enabled일 때 상단에 상주하며 클릭 시 빠른 설정을 연다.
 */

import "./capture-indicator.css";
import type { createScreenshotSettings } from "../io/screenshot-settings";
import { t } from "./i18n";

type ScreenshotSettingsStore = ReturnType<typeof createScreenshotSettings>;

interface CaptureIndicatorOptions {
  mount: HTMLElement;
  settings: ScreenshotSettingsStore;
  onActivate: () => void;
}

interface CaptureIndicator {
  el: HTMLElement;
  dispose(): void;
}

export function createCaptureIndicator({
  mount,
  settings,
  onActivate,
}: CaptureIndicatorOptions): CaptureIndicator {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-capture";
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <svg class="yui-capture__view" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"
        stroke="currentColor" stroke-width="1.7" stroke-linecap="round"
      />
      <circle cx="12" cy="12" r="2.4" stroke="currentColor" stroke-width="1.7"/>
    </svg>
    <span>${t("capture.watching")}</span>
    <span class="yui-capture__live" aria-hidden="true"></span>
  `;

  mount.appendChild(el);

  // 기본은 접근성 트리에서 빠진 상태 — 캡처가 켜질 때 show()가 되돌린다.
  el.hidden = true;

  let visible = false;

  function show(): void {
    if (visible) return;
    visible = true;
    // 전이 시작 전에 접근성 트리로 되돌린다 — is-visible보다 먼저.
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-visible"));
  }

  function hide(): void {
    if (!visible) return;
    visible = false;
    el.classList.remove("is-visible");
    // 접근성 트리에서도 완전히 제거한다 — 스크린리더가 유휴 상태를 읽지 않게.
    el.hidden = true;
  }

  // settings 반영 (초기 + 구독)
  function reflect(enabled: boolean): void {
    if (enabled) show();
    else hide();
  }

  reflect(settings.get().enabled);
  const unsubscribe = settings.subscribe((s) => reflect(s.enabled));

  function handleClick(): void {
    onActivate();
  }

  el.addEventListener("click", handleClick);

  function dispose(): void {
    unsubscribe();
    el.removeEventListener("click", handleClick);
    el.remove();
  }

  return { el, dispose };
}
