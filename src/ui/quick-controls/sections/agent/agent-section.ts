/**
 * Agent section — owns the locale picker segment, the reasoning-effort segment, and the chat
 * instructions textarea. Same pattern as sibling sections: explicit deps + wired from shell.
 * This module owns handlers, subscriptions, redraws, teardown.
 */

import type { Logger } from "../../../../logger";
import {
  type createAgentSettings,
  REASONING_EFFORTS,
} from "../../../../settings/backend/agent-settings";
import { getLocale, type Locale, setLocale, t } from "../../../i18n";
import { LANG_PICKER_ORDER } from "../../constants";
import { handleSegmentKeydown } from "../../seg-keyboard";

type AgentSettingsStore = ReturnType<typeof createAgentSettings>;

interface AgentSectionDeps {
  /** Panel root (el) — query the locale segment, effort segment, and instructions textarea here. */
  root: HTMLElement;
  /** Reasoning-effort + instructions store — its subscription redraws the segment and textarea. */
  agentSettings: AgentSettingsStore;
  /** Default instructions shown as textarea placeholder while the value is empty (undefined if not loaded). */
  getDefaultInstructions?: () => string | undefined;
  /** Popover open state — the store subscription redraws only while the panel is open. */
  isOpen: () => boolean;
  /** Logger — section-scoped changes report here. */
  log: Logger;
}

interface AgentSection {
  /** Render the reasoning-effort segment and the instructions textarea from the store. */
  reflect(): void;
  /** Render the locale segment from the current display language. */
  reflectLanguage(): void;
  /** Permanent teardown — unsubscribe the store and remove all listeners. */
  dispose(): void;
}

export function createAgentSection(deps: AgentSectionDeps): AgentSection {
  const { root: el, agentSettings, getDefaultInstructions, isOpen, log } = deps;

  const segEl = el.querySelector<HTMLDivElement>(".yui-effort-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const instructionsEl = el.querySelector<HTMLTextAreaElement>(".yui-textarea")!;
  const resetBtn = el.querySelector<HTMLButtonElement>(".yui-reset")!;
  // Language picker segment (3 buttons) node.
  const langSegEl = el.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));

  // Default instructions placeholder.
  const defaultInstr = getDefaultInstructions?.();
  instructionsEl.placeholder =
    defaultInstr && defaultInstr.length > 0 ? defaultInstr : t("instructions.placeholder_default");

  function reflectAgent(): void {
    const a = agentSettings.get();
    const idx = Math.max(0, REASONING_EFFORTS.indexOf(a.reasoning_effort));
    segButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    // Do not overwrite textarea while typing (remote changes apply on blur).
    if (
      (!document.hasFocus() || document.activeElement !== instructionsEl) &&
      instructionsEl.value !== a.instructions
    ) {
      instructionsEl.value = a.instructions;
    }
  }

  // Language picker — reflects current display language onto selected seg.
  function reflectLanguage(): void {
    const idx = Math.max(0, LANG_PICKER_ORDER.indexOf(getLocale()));
    langSegButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
  }

  const unsubscribeAgent = agentSettings.subscribe(() => {
    if (isOpen()) reflectAgent();
  });

  // Language picker — WAI-ARIA "selection doesn't follow focus" radio pattern.
  // setLocale changes entire UI language and triggers host remount (expensive/destructive),
  // so arrows only move focus; Space/Enter/click commits.

  // Arrows/Home/End — roving tabindex + move focus only (no commit/aria-checked change).
  function moveLocaleFocus(index: number): void {
    const clamped = Math.min(langSegButtons.length - 1, Math.max(0, index));
    const btn = langSegButtons[clamped];
    if (!btn) return;
    for (const b of langSegButtons) b.tabIndex = -1;
    btn.tabIndex = 0;
    btn.focus();
  }

  // Commit (click/Space/Enter) — only path that actually changes display language.
  function commitLocale(index: number): void {
    const clamped = Math.min(langSegButtons.length - 1, Math.max(0, index));
    const locale = langSegButtons[clamped]?.dataset.locale as Locale | undefined;
    if (!locale) return;
    log.info("ui_language_change", { locale });
    setLocale(locale);
    // locale seg has no store subscription — directly reflect aria/tabindex until remount.
    reflectLanguage();
    langSegButtons[clamped]?.focus();
  }

  function handleLangSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    const idx = langSegButtons.indexOf(btn);
    if (idx < 0) return;
    commitLocale(idx);
  }

  function handleLangSegKeydown(e: KeyboardEvent): void {
    handleSegmentKeydown(e, langSegButtons, {
      length: langSegButtons.length,
      // Arrow baseline: currently focused radio (else checked one, else 0).
      getBaseIndex: () => {
        const active = document.activeElement;
        const focusIdx = active instanceof HTMLButtonElement ? langSegButtons.indexOf(active) : -1;
        const checkedIdx = langSegButtons.findIndex(
          (b) => b.getAttribute("aria-checked") === "true",
        );
        return focusIdx >= 0 ? focusIdx : checkedIdx < 0 ? 0 : checkedIdx;
      },
      onNavigate: (index) => moveLocaleFocus(index),
      // The shared handler's preventDefault stops the native button click from committing twice.
      onCommit: (index) => commitLocale(index),
    });
  }

  // ── Reasoning-effort segment ──

  function selectEffort(index: number, focus = false): void {
    const clamped = Math.min(REASONING_EFFORTS.length - 1, Math.max(0, index));
    const effort = REASONING_EFFORTS[clamped];
    agentSettings.setReasoningEffort(effort);
    log.info("reasoning_effort_change", { effort });
    // Store subscription will call reflectAgent to update visuals/aria.
    if (focus) segButtons[clamped]?.focus();
  }

  function handleSegClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    selectEffort(segButtons.indexOf(btn));
  }

  function handleSegKeydown(e: KeyboardEvent): void {
    handleSegmentKeydown(e, segButtons, {
      length: REASONING_EFFORTS.length,
      getBaseIndex: () => {
        const current = segButtons.findIndex((b) => b.getAttribute("aria-checked") === "true");
        return current < 0 ? 0 : current;
      },
      onNavigate: (index, focus) => selectEffort(index, focus),
      // No onCommit — native <button> Space/Enter already fires click (handleSegClick).
    });
  }

  // ── Instructions textarea ──

  function handleInstructionsInput(): void {
    agentSettings.setInstructions(instructionsEl.value);
    log.info("instructions_change", { length: instructionsEl.value.length });
  }

  // On blur, reflect pending remote changes from mid-edit.
  function handleInstructionsBlur(): void {
    reflectAgent();
  }

  function handleResetInstructions(): void {
    agentSettings.setInstructions("");
    instructionsEl.value = "";
    log.info("instructions_reset");
  }

  langSegEl.addEventListener("click", handleLangSegClick);
  langSegEl.addEventListener("keydown", handleLangSegKeydown);
  segEl.addEventListener("click", handleSegClick);
  segEl.addEventListener("keydown", handleSegKeydown);
  instructionsEl.addEventListener("input", handleInstructionsInput);
  instructionsEl.addEventListener("blur", handleInstructionsBlur);
  resetBtn.addEventListener("click", handleResetInstructions);

  return {
    reflect: reflectAgent,
    reflectLanguage,
    dispose(): void {
      unsubscribeAgent();
      langSegEl.removeEventListener("click", handleLangSegClick);
      langSegEl.removeEventListener("keydown", handleLangSegKeydown);
      segEl.removeEventListener("click", handleSegClick);
      segEl.removeEventListener("keydown", handleSegKeydown);
      instructionsEl.removeEventListener("input", handleInstructionsInput);
      instructionsEl.removeEventListener("blur", handleInstructionsBlur);
      resetBtn.removeEventListener("click", handleResetInstructions);
    },
  };
}
