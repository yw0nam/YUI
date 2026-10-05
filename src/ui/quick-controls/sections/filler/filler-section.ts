/**
 * Thinking-filler section — owns the language segment and the six phrase-pool textareas: element
 * queries, handlers, listeners, the store subscription, and the store→DOM reflect. The shell calls
 * reflect() on open; the enable toggle is a generic switch row outside this module.
 */

import { FILLER_LANGS } from "../../../../config/validators/filler";
import type { createFillerSettings } from "../../../../settings/voice/filler-settings";
import { handleSegmentKeydown } from "../../seg-keyboard";
import { parseToolLines, serializeToolLines } from "./filler-tool-lines";

type FillerSettingsStore = ReturnType<typeof createFillerSettings>;

interface FillerSectionDeps {
  /** Panel root (el) — query the language segment and the pool textareas here. */
  root: HTMLElement;
  /** Thinking filler settings store. Absent when the section is not rendered. */
  fillerSettings?: FillerSettingsStore;
  /** Popover open state — the store subscription redraws only while the panel is open. */
  isOpen: () => boolean;
  /** Switch-row redraw — the store subscription calls it before reflect(). */
  reflectSwitchRows: () => void;
}

interface FillerSection {
  /** Render the store's language and that language's pool onto the segment and textareas. */
  reflect(): void;
  /** Permanent teardown — remove all listeners. */
  dispose(): void;
}

// Parse textarea rows line-by-line (trim + remove empty lines).
function parseFillerLines(el: HTMLTextAreaElement | null): string[] {
  if (!el) return [];
  return el.value
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function createFillerSection(deps: FillerSectionDeps): FillerSection {
  const { root: el, fillerSettings, isOpen, reflectSwitchRows } = deps;
  if (!fillerSettings) return { reflect() {}, dispose() {} };
  const store = fillerSettings;

  // Section nodes — null when the markup is not rendered.
  const langSegEl = el.querySelector<HTMLDivElement>(".yui-filler-lang-seg");
  const langBtns = langSegEl
    ? Array.from(langSegEl.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"))
    : [];
  const firstTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-first-textarea");
  const repeatTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-repeat-textarea");
  const longWaitTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-long-wait-textarea",
  );
  const timeoutTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-timeout-textarea");
  const unreachableTextareaEl = el.querySelector<HTMLTextAreaElement>(
    ".yui-filler-unreachable-textarea",
  );
  const toolTextareaEl = el.querySelector<HTMLTextAreaElement>(".yui-filler-tool-textarea");
  const textareaEls = [
    firstTextareaEl,
    repeatTextareaEl,
    longWaitTextareaEl,
    timeoutTextareaEl,
    unreachableTextareaEl,
    toolTextareaEl,
  ];

  // Reflect thinking-filler store updates to section (includes other-window reloadFromStorage).
  const unsubscribe = store.subscribe(() => {
    if (isOpen()) {
      reflectSwitchRows();
      reflect();
    }
  });

  function reflect(): void {
    if (!langSegEl || !firstTextareaEl || !repeatTextareaEl) return;
    const s = store.get();
    const idx = Math.max(0, FILLER_LANGS.indexOf(s.language));
    langBtns.forEach((btn, i) => {
      const selected = i === idx;
      btn.setAttribute("aria-checked", String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    // Show current language's customPool, one tier per textarea (empty if not set).
    const pool = s.customPools[s.language];
    firstTextareaEl.value = (pool?.first ?? []).join("\n");
    repeatTextareaEl.value = (pool?.repeat ?? []).join("\n");
    if (longWaitTextareaEl) longWaitTextareaEl.value = (pool?.long_wait ?? []).join("\n");
    if (timeoutTextareaEl) timeoutTextareaEl.value = (pool?.timeout ?? []).join("\n");
    if (unreachableTextareaEl) unreachableTextareaEl.value = (pool?.unreachable ?? []).join("\n");
    if (toolTextareaEl) toolTextareaEl.value = serializeToolLines(pool?.tool ?? {});
  }

  // Persist the language, then reflect() writes aria/tabindex and the textareas for it.
  function selectLang(index: number, focus = false): void {
    const clamped = Math.min(FILLER_LANGS.length - 1, Math.max(0, index));
    store.setLanguage(FILLER_LANGS[clamped]);
    reflect();
    if (focus) langBtns[clamped]?.focus();
  }

  function handleLangClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!btn) return;
    const idx = langBtns.indexOf(btn);
    if (idx < 0) return;
    selectLang(idx);
  }

  // Roving-focus keyboard like reasoning-effort segment. Arrows select+focus, Space/Enter selects target.
  function handleLangKeydown(e: KeyboardEvent): void {
    handleSegmentKeydown(e, langBtns, {
      length: FILLER_LANGS.length,
      getBaseIndex: () => {
        const current = langBtns.findIndex((b) => b.getAttribute("aria-checked") === "true");
        return current < 0 ? 0 : current;
      },
      onNavigate: (index, focus) => selectLang(index, focus),
      onCommit: (index) => selectLang(index, true),
    });
  }

  // When editing any one field, write every field's current value together so none clobbers another.
  function handleTextareaInput(): void {
    store.setCustomPool(store.get().language, {
      first: parseFillerLines(firstTextareaEl),
      repeat: parseFillerLines(repeatTextareaEl),
      long_wait: parseFillerLines(longWaitTextareaEl),
      timeout: parseFillerLines(timeoutTextareaEl),
      unreachable: parseFillerLines(unreachableTextareaEl),
      tool: parseToolLines(toolTextareaEl?.value ?? ""),
    });
  }

  langSegEl?.addEventListener("click", handleLangClick);
  langSegEl?.addEventListener("keydown", handleLangKeydown);
  for (const textareaEl of textareaEls) textareaEl?.addEventListener("input", handleTextareaInput);

  return {
    reflect,
    dispose(): void {
      unsubscribe();
      langSegEl?.removeEventListener("click", handleLangClick);
      langSegEl?.removeEventListener("keydown", handleLangKeydown);
      for (const textareaEl of textareaEls) {
        textareaEl?.removeEventListener("input", handleTextareaInput);
      }
    },
  };
}
