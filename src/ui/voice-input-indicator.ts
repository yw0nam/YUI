import "./voice-input-indicator.css";
import { t } from "./i18n";
import { isSettingsFixable } from "./turn-error";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "./voice-input-status";

interface VoiceInputIndicatorOptions {
  mount: HTMLElement;
  status: VoiceInputStatus;
  onActivate: () => void;
  /** Opens the panel the fix affordance points at (Settings → Advanced). */
  onOpenSettings: () => void;
}

interface VoiceInputIndicator {
  el: HTMLElement;
  dispose(): void;
}

export function createVoiceInputIndicator({
  mount,
  status,
  onActivate,
  onOpenSettings,
}: VoiceInputIndicatorOptions): VoiceInputIndicator {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-voice";
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <span class="yui-voice__dot" aria-hidden="true"></span>
    <span class="yui-voice__label"></span>
    <svg class="yui-voice__fix-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.3v1.9M8 12.8v1.9M14.7 8h-1.9M3.2 8H1.3M12.74 3.26l-1.34 1.34M4.6 11.4l-1.34 1.34M12.74 12.74l-1.34-1.34M4.6 4.6L3.26 3.26" />
    </svg>
  `;

  const labelEl = el.querySelector<HTMLSpanElement>(".yui-voice__label")!;
  mount.appendChild(el);

  function reflect(snapshot: VoiceInputStatusSnapshot): void {
    // A failure the settings panel can resolve turns the chip into the fix itself:
    // reason-specific label, gear glyph, and a click that goes to Settings.
    const fixable = snapshot.state === "error" && isSettingsFixable(snapshot.detail);
    // Map state → translated label directly; ignore the baked snapshot.label so
    // the visible text/aria stays correct across a locale change + host re-mount.
    const label = fixable ? t("voice.error.not_configured") : t(`voice.state.${snapshot.state}`);
    el.dataset.state = snapshot.state;
    if (fixable) el.dataset.fix = "settings";
    else delete el.dataset.fix;
    labelEl.textContent = label;
    // The fix state announces the destination, not just the condition.
    const announced = fixable ? t("voice.error.not_configured_fix") : label;
    el.setAttribute("aria-label", t("aria.voice_input", { label: announced }));
    el.classList.toggle("is-visible", snapshot.visible);
  }

  function handleClick(): void {
    if (el.dataset.fix !== "settings") {
      onActivate();
      return;
    }
    onOpenSettings();
    // The held error has served its purpose; hand the chip back to the live state.
    status.set("listening");
  }

  reflect(status.get());
  const unsubscribe = status.subscribe(reflect);
  el.addEventListener("click", handleClick);

  function dispose(): void {
    unsubscribe();
    el.removeEventListener("click", handleClick);
    el.remove();
  }

  return { el, dispose };
}
