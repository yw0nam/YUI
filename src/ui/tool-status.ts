/**
 * Tool-status indicator — a chip observing backend tool calls.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the running/done state
 * the backend reports. No brain, persona, or mode branching lives here.
 */

import { afterFadeOut } from "./fade-out";
import { t } from "./i18n";
import { getToolLabel } from "./tool-labels";

export interface ToolStatus {
  /** Show a running chip for tool_id (label from tool-labels lookup, humanized if unmapped). */
  showTool(toolId: string): void;
  /** Transition the running chip to done (check), then auto-dismiss shortly after. Ignored if no chip. */
  finishTool(): void;
  /** Hide the chip immediately. */
  hideTool(): void;
  /** Clear the pending hide timer, if any. */
  dispose(): void;
}

export interface ToolStatusElements {
  toolEl: HTMLElement;
  toolLabel: HTMLElement;
}

const TOOL_DONE_HOLD_MS = 1500;
// Exceeds the chip's own --yui-dur-out (650ms) dismiss transition — see fade-out.ts's default.
const TOOL_FADE_FALLBACK_MS = 900;

export function createToolStatus({ toolEl, toolLabel }: ToolStatusElements): ToolStatus {
  let toolHideTimer: ReturnType<typeof setTimeout> | null = null;
  let showFrame: number | null = null;
  let cancelFade: (() => void) | null = null;
  let disposed = false;

  // A webview stops painting while occluded, so a queued frame can land long after a hide.
  function clearShowFrame(): void {
    if (showFrame !== null) {
      cancelAnimationFrame(showFrame);
      showFrame = null;
    }
  }

  function clearToolTimer(): void {
    if (toolHideTimer !== null) {
      clearTimeout(toolHideTimer);
      toolHideTimer = null;
    }
  }

  function showTool(toolId: string): void {
    if (disposed) return;
    clearToolTimer();
    // A re-show interrupting a dismissal must cancel that fade outright — its stale settle
    // landing later could otherwise hide the chip again before is-visible is even back.
    cancelFade?.();
    cancelFade = null;
    toolLabel.textContent = getToolLabel(toolId);
    toolEl.dataset.state = "running";
    toolEl.hidden = false;
    // A re-show interrupting a dismissal must re-enter from the fast/near path, not the drifted one.
    toolEl.classList.remove("is-hiding");
    clearShowFrame();
    showFrame = requestAnimationFrame(() => {
      showFrame = null;
      toolEl.classList.add("is-visible");
    });
  }

  function finishTool(): void {
    if (disposed) return;
    if (toolEl.hidden) return;
    clearToolTimer();
    toolEl.dataset.state = "done";
    toolLabel.textContent = t("tool.done_label");
    toolHideTimer = setTimeout(() => {
      toolHideTimer = null;
      hideTool();
    }, TOOL_DONE_HOLD_MS);
  }

  function hideTool(): void {
    clearToolTimer();
    clearShowFrame();
    toolEl.classList.remove("is-visible");
    toolEl.classList.add("is-hiding");
    cancelFade?.();
    cancelFade = afterFadeOut(
      toolEl,
      () => {
        cancelFade = null;
        if (!toolEl.classList.contains("is-visible")) toolEl.hidden = true;
      },
      TOOL_FADE_FALLBACK_MS,
    );
  }

  function dispose(): void {
    disposed = true;
    clearToolTimer();
    clearShowFrame();
    cancelFade?.();
    cancelFade = null;
  }

  return { showTool, finishTool, hideTool, dispose };
}
