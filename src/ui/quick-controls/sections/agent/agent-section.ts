/**
 * Agent section — owns the locale picker segment and the reasoning-effort segment. The effort
 * segment shows on the request transports only.
 * Same pattern as sibling sections: explicit deps + wired from shell.
 * This module owns handlers, subscriptions, redraws, teardown.
 */

import type { Logger } from "../../../../logger";
import {
  type createAgentSettings,
  REASONING_EFFORTS,
} from "../../../../settings/backend/agent-settings";
import type { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { getLocale, type Locale, setLocale, t } from "../../../i18n";
import { LANG_PICKER_ORDER, SEG_LABEL_KEYS } from "../../constants";
import { handleSegmentKeydown } from "../../seg-keyboard";

/** The reasoning-effort row in a section of its own. */
export function effortSectionHtml(): string {
  const buttons = REASONING_EFFORTS.map(
    (e) =>
      `<button class="yui-seg__btn" type="button" role="radio" data-effort="${e}" aria-checked="false" tabindex="-1">${t(SEG_LABEL_KEYS[e])}</button>`,
  ).join("");
  return `
        <div class="yui-sec">
          <div class="yui-group">
            <div class="yui-row">
              <div class="yui-row__main">
                <span class="yui-row__label">${t("reasoning.label")}</span>
                <span class="yui-row__sub">${t("reasoning.sub")}</span>
              </div>
              <div class="yui-seg yui-effort-seg" role="radiogroup" aria-label="${t("reasoning.label")}">${buttons}</div>
            </div>
          </div>
        </div>`;
}

type AgentSettingsStore = ReturnType<typeof createAgentSettings>;
type EndpointsSettingsStore = Pick<ReturnType<typeof createEndpointsSettings>, "subscribe">;

interface AgentSectionDeps {
  /** Panel root (el) — query the locale segment and effort segment here. */
  root: HTMLElement;
  /** Reasoning-effort store — its subscription redraws the segment. */
  agentSettings: AgentSettingsStore;
  /** Endpoint overrides store — its subscription re-evaluates which transport is selected. */
  endpointsSettings: EndpointsSettingsStore;
  /** Whether push chat is the effective mode; the effort segment is hidden then. */
  isPushMode: () => boolean;
  /** Popover open state — the store subscription redraws only while the panel is open. */
  isOpen: () => boolean;
  /** Logger — section-scoped changes report here. */
  log: Logger;
}

interface AgentSection {
  /** Render the effort segment from the store and show it on request transports only. */
  reflect(): void;
  /** Render the locale segment from the current display language. */
  reflectLanguage(): void;
  /** Permanent teardown — unsubscribe the store and remove all listeners. */
  dispose(): void;
}

export function createAgentSection(deps: AgentSectionDeps): AgentSection {
  const { root: el, agentSettings, endpointsSettings, isPushMode, isOpen, log } = deps;

  const segEl = el.querySelector<HTMLDivElement>(".yui-effort-seg")!;
  const segButtons = Array.from(segEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
  const effortSecEl = segEl.closest<HTMLElement>(".yui-sec")!;
  // Language picker segment (3 buttons) node.
  const langSegEl = el.querySelector<HTMLDivElement>(".yui-lang-seg")!;
  const langSegButtons = Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));

  function reflectAgent(): void {
    effortSecEl.hidden = isPushMode();
    const a = agentSettings.get();
    const idx = Math.max(0, REASONING_EFFORTS.indexOf(a.reasoning_effort));
    segButtons.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
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
  const unsubscribeEndpoints = endpointsSettings.subscribe(() => {
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

  langSegEl.addEventListener("click", handleLangSegClick);
  langSegEl.addEventListener("keydown", handleLangSegKeydown);
  segEl.addEventListener("click", handleSegClick);
  segEl.addEventListener("keydown", handleSegKeydown);

  return {
    reflect: reflectAgent,
    reflectLanguage,
    dispose(): void {
      unsubscribeAgent();
      unsubscribeEndpoints();
      langSegEl.removeEventListener("click", handleLangSegClick);
      langSegEl.removeEventListener("keydown", handleLangSegKeydown);
      segEl.removeEventListener("click", handleSegClick);
      segEl.removeEventListener("keydown", handleSegKeydown);
    },
  };
}
