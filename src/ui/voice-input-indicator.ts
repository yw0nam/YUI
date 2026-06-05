import "./voice-input-indicator.css";
import type { VoiceInputStatus, VoiceInputStatusSnapshot } from "./voice-input-status";

interface VoiceInputIndicatorOptions {
  mount: HTMLElement;
  status: VoiceInputStatus;
  onActivate: () => void;
}

interface VoiceInputIndicator {
  el: HTMLElement;
  dispose(): void;
}

export function createVoiceInputIndicator({
  mount,
  status,
  onActivate,
}: VoiceInputIndicatorOptions): VoiceInputIndicator {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-voice";
  el.setAttribute("aria-live", "polite");
  el.innerHTML = `
    <span class="yui-voice__dot" aria-hidden="true"></span>
    <span class="yui-voice__label"></span>
  `;

  const labelEl = el.querySelector<HTMLSpanElement>(".yui-voice__label")!;
  mount.appendChild(el);

  function reflect(snapshot: VoiceInputStatusSnapshot): void {
    el.dataset.state = snapshot.state;
    labelEl.textContent = snapshot.label;
    el.setAttribute("aria-label", `음성 입력: ${snapshot.label}`);
    el.classList.toggle("is-visible", snapshot.visible);
  }

  function handleClick(): void {
    onActivate();
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
