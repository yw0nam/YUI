/**
 * Status pill — the capture, voice and tool tells in one pill at the top of the character window.
 *
 * Pure renderer — firing ≠ judgment: it draws what the screenshot setting, the voice status and
 * the backend's tool calls report. No brain, persona, or mode branching lives here.
 */

import "./status-pill.css";
import type { createScreenshotSettings } from "../../settings/capture/screenshot-settings";
import { subscribe as subscribeLocale, t } from "../i18n";
import { afterFadeOut } from "../notices/fade-out";
import { isSettingsFixable } from "../notices/turn-error";
import { getToolLabel } from "./tool-labels";
import type { VoiceInputStatus } from "./voice-input-status";

export interface ToolStatus {
  /** Show the running tool segment for tool_id (label from tool-labels lookup, humanized if unmapped). */
  showTool(toolId: string): void;
  /** Turn the running segment to done (check), then clear it after the hold. Ignored if none. */
  finishTool(): void;
  /** Clear the tool segment immediately. */
  hideTool(): void;
}

export interface StatusPill extends ToolStatus {
  dispose(): void;
}

interface StatusPillOptions {
  mount: HTMLElement;
  settings: Pick<ReturnType<typeof createScreenshotSettings>, "get" | "subscribe">;
  voice: VoiceInputStatus;
  onOpenSettings: () => void;
  onFixVoice: () => void;
}

const TOOL_DONE_HOLD_MS = 1500;

export function createStatusPill({
  mount,
  settings,
  voice,
  onOpenSettings,
  onFixVoice,
}: StatusPillOptions): StatusPill {
  const el = document.createElement("div");
  el.className = "yui-status";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.hidden = true;
  el.innerHTML = `
    <button class="yui-status__capture" type="button" hidden>
      <svg class="yui-status__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
        <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
        <circle cx="12" cy="12" r="2.4" />
      </svg>
      <span class="yui-status__capture-dot" aria-hidden="true"></span>
    </button>
    <button class="yui-status__voice" type="button" hidden tabindex="-1">
      <svg class="yui-status__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M6 11a6 6 0 0 0 12 0M12 17v4" />
      </svg>
    </button>
    <span class="yui-status__sep" hidden aria-hidden="true"></span>
    <span class="yui-status__dot" hidden aria-hidden="true"></span>
    <span class="yui-status__label" hidden></span>
    <svg class="yui-status__fix-glyph" viewBox="0 0 16 16" fill="none" stroke="currentColor"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.3v1.9M8 12.8v1.9M14.7 8h-1.9M3.2 8H1.3M12.74 3.26l-1.34 1.34M4.6 11.4l-1.34 1.34M12.74 12.74l-1.34-1.34M4.6 4.6L3.26 3.26" />
    </svg>
  `;
  const captureBtn = el.querySelector<HTMLButtonElement>(".yui-status__capture")!;
  const voiceBtn = el.querySelector<HTMLButtonElement>(".yui-status__voice")!;
  const sepEl = el.querySelector<HTMLElement>(".yui-status__sep")!;
  const dotEl = el.querySelector<HTMLElement>(".yui-status__dot")!;
  const labelEl = el.querySelector<HTMLElement>(".yui-status__label")!;
  mount.appendChild(el);

  let tool: { state: "running" | "done"; label: string } | null = null;
  let toolHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let showFrame: number | null = null;
  let cancelFade: (() => void) | null = null;
  let disposed = false;

  function render(): void {
    const captureOn = settings.get().enabled;
    const snapshot = voice.get();
    const shown = captureOn || snapshot.visible || tool !== null;
    // A leaving pill keeps its last content through the fade, but no longer offers the fix.
    if (!shown) {
      delete el.dataset.fix;
      voiceBtn.tabIndex = -1;
      setShown(false);
      return;
    }
    const fixable = snapshot.state === "error" && isSettingsFixable(snapshot.detail);
    const voiceLabel = fixable
      ? t("voice.error.not_configured")
      : t(`voice.state.${snapshot.state}`);

    captureBtn.hidden = !captureOn;
    captureBtn.setAttribute("aria-label", t("capture.watching"));

    voiceBtn.hidden = !snapshot.visible;
    voiceBtn.dataset.voice = snapshot.state;
    // The fix state announces the destination, not just the condition.
    const announced = fixable ? t("voice.error.not_configured_fix") : voiceLabel;
    voiceBtn.setAttribute("aria-label", t("aria.voice_input", { label: announced }));

    delete dotEl.dataset.tool;
    delete dotEl.dataset.voice;
    let label = "";
    if (tool) {
      dotEl.dataset.tool = tool.state;
      label = tool.label;
    } else if (snapshot.visible) {
      dotEl.dataset.voice = snapshot.state;
      label = voiceLabel;
    }
    const segment = label !== "";
    labelEl.textContent = label;
    labelEl.hidden = !segment;
    dotEl.hidden = !segment;
    sepEl.hidden = !segment || !(captureOn || snapshot.visible);

    // The fix link only exists while the voice owns the segment.
    const fixShown = fixable && !tool;
    if (fixShown) el.dataset.fix = "settings";
    else delete el.dataset.fix;
    voiceBtn.tabIndex = fixShown ? 0 : -1;

    setShown(true);
  }

  // A webview stops painting while occluded, so a queued frame can land long after a hide.
  function clearShowFrame(): void {
    if (showFrame !== null) {
      cancelAnimationFrame(showFrame);
      showFrame = null;
    }
  }

  function setShown(shown: boolean): void {
    if (shown) {
      // A re-show must cancel an in-flight dismissal outright; its stale settle would hide the pill.
      cancelFade?.();
      cancelFade = null;
      if (!el.hidden && el.classList.contains("is-visible")) return;
      el.hidden = false;
      if (showFrame !== null) return;
      showFrame = requestAnimationFrame(() => {
        showFrame = null;
        el.classList.add("is-visible");
      });
      return;
    }
    clearShowFrame();
    if (el.hidden || cancelFade) return;
    el.classList.remove("is-visible");
    // Leave the a11y tree only once the fade ends, so hidden=true never cuts the transition.
    cancelFade = afterFadeOut(el, () => {
      cancelFade = null;
      el.hidden = true;
    });
  }

  function clearToolHold(): void {
    if (toolHoldTimer !== null) {
      clearTimeout(toolHoldTimer);
      toolHoldTimer = null;
    }
  }

  function showTool(toolId: string): void {
    if (disposed) return;
    clearToolHold();
    tool = { state: "running", label: getToolLabel(toolId) };
    render();
  }

  function finishTool(): void {
    if (disposed || !tool) return;
    clearToolHold();
    tool.state = "done";
    render();
    toolHoldTimer = setTimeout(() => {
      toolHoldTimer = null;
      hideTool();
    }, TOOL_DONE_HOLD_MS);
  }

  function hideTool(): void {
    if (disposed) return;
    clearToolHold();
    tool = null;
    render();
  }

  function handleClick(e: MouseEvent): void {
    if (captureBtn.contains(e.target as Node)) {
      onOpenSettings();
      return;
    }
    if (el.dataset.fix !== "settings") return;
    onFixVoice();
    // The held error has served its purpose; hand the pill back to the live state.
    voice.set("listening");
  }

  render();
  const unsubscribeSettings = settings.subscribe(render);
  const unsubscribeVoice = voice.subscribe(render);
  const unsubscribeLocale = subscribeLocale(render);
  el.addEventListener("click", handleClick);

  function dispose(): void {
    disposed = true;
    clearToolHold();
    clearShowFrame();
    cancelFade?.();
    cancelFade = null;
    unsubscribeSettings();
    unsubscribeVoice();
    unsubscribeLocale();
    el.removeEventListener("click", handleClick);
    el.remove();
  }

  return { showTool, finishTool, hideTool, dispose };
}
