/**
 * Tool-status indicator — a chip observing backend tool calls.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the running/done state
 * the backend reports. No brain, persona, or mode branching lives here.
 */

import { afterFadeOut } from "./fade-out";
import { getToolLabel } from "./tool-labels";

export interface ToolStatus {
  /** Show a running chip for tool_id (label from tool-labels lookup, humanized if unmapped). */
  showTool(toolId: string): void;
  /** Transition the running chip to done (check), then auto-dismiss shortly after. Ignored if no chip. */
  finishTool(): void;
  /** Hide the chip immediately. */
  hideTool(): void;
}

export interface ToolStatusElements {
  toolEl: HTMLElement;
  toolLabel: HTMLElement;
}

const TOOL_DONE_HOLD_MS = 500;

export function createToolStatus({ toolEl, toolLabel }: ToolStatusElements): ToolStatus {
  let toolHideTimer: ReturnType<typeof setTimeout> | null = null;

  function clearToolTimer(): void {
    if (toolHideTimer !== null) {
      clearTimeout(toolHideTimer);
      toolHideTimer = null;
    }
  }

  function showTool(toolId: string): void {
    clearToolTimer();
    toolLabel.textContent = getToolLabel(toolId);
    toolEl.dataset.state = "running";
    toolEl.hidden = false;
    requestAnimationFrame(() => toolEl.classList.add("is-visible"));
  }

  function finishTool(): void {
    if (toolEl.hidden) return;
    clearToolTimer();
    toolEl.dataset.state = "done";
    toolHideTimer = setTimeout(() => {
      toolHideTimer = null;
      hideTool();
    }, TOOL_DONE_HOLD_MS);
  }

  function hideTool(): void {
    clearToolTimer();
    toolEl.classList.remove("is-visible");
    afterFadeOut(toolEl, () => {
      if (!toolEl.classList.contains("is-visible")) toolEl.hidden = true;
    });
  }

  return { showTool, finishTool, hideTool };
}
