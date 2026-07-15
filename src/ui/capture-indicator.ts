/**
 * Capture indicator — R7 always-ON privacy tell.
 * Sits at the top while screenshots are enabled; clicking it opens quick settings.
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

  // Absent from the a11y tree by default — show() restores it when capture turns on.
  el.hidden = true;

  let visible = false;

  function show(): void {
    if (visible) return;
    visible = true;
    // Restore it to the a11y tree before the transition starts — ahead of is-visible.
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-visible"));
  }

  function hide(): void {
    if (!visible) return;
    visible = false;
    el.classList.remove("is-visible");
    // Remove it from the a11y tree only after the fade-out ends — so hidden=true doesn't kill the transition.
    // Cancel if show() runs again (visible) in the meantime. Same pattern as popover close.
    const settle = (): void => {
      if (!visible) el.hidden = true;
    };
    // Fallback for environments where the transition never fires. A rAF (next frame ~16ms) is
    // shorter than the fade (--yui-dur 200ms / -fast 140ms) and would cut it off, so the timer must exceed that ceiling.
    const fb = setTimeout(settle, 400); // ponytail: safety net exceeding the --yui-dur/-fast ceiling
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      clearTimeout(fb);
      el.removeEventListener("transitionend", onEnd);
      settle();
    };
    el.addEventListener("transitionend", onEnd);
  }

  // Reflect settings (initial + subscription)
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
