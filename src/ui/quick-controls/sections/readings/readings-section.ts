/**
 * Reading dictionary section of the Input tab: the markup, the textarea edits and the line that
 * names skipped lines. It owns its subscription and teardown.
 */

import { parseReadings } from "../../../../io/voice/tts/readings";
import type { createReadingsSettings } from "../../../../settings/voice/readings-settings";
import { t } from "../../../i18n";
import { secHeadHtml } from "../../markup";
import "./readings-section.css";

type ReadingsSettingsStore = ReturnType<typeof createReadingsSettings>;

interface ReadingsSectionDeps {
  /** Panel root (el) — the section's nodes are queried here. */
  root: HTMLElement;
  /** Absent when the section is not rendered. */
  readingsSettings?: ReadingsSettingsStore;
}

// The same example in every language: the Korean bundle carries no Japanese script.
const PLACEHOLDER = "秧秧=ヤンヤン\n穂穂=スイスイ";

export function readingsSectionHtml(): string {
  return `
        <div class="yui-sec yui-reading">
          ${secHeadHtml(t("reading.section"))}
          <p class="yui-sec__note">${t("reading.note")}</p>
          <div class="yui-group">
            <div class="yui-stack yui-input-row yui-reading__entry">
              <span class="yui-row__sub">${t("reading.sub")}</span>
              <textarea class="yui-textarea yui-textarea--short" spellcheck="false" rows="4" aria-label="${t("reading.aria")}" placeholder="${PLACEHOLDER}"></textarea>
              <p class="yui-input-row__error yui-reading__skipped" role="status"></p>
            </div>
          </div>
          <p class="yui-sec__foot">${t("reading.foot")}</p>
        </div>`;
}

export function createReadingsSection(deps: ReadingsSectionDeps): { dispose(): void } {
  const { root, readingsSettings: store } = deps;
  const textareaEl = root.querySelector<HTMLTextAreaElement>(".yui-reading textarea");
  const entryEl = root.querySelector<HTMLElement>(".yui-reading__entry");
  const skippedEl = root.querySelector<HTMLElement>(".yui-reading__skipped");
  if (!store || !textareaEl || !entryEl || !skippedEl) return { dispose() {} };

  function showSkipped(): void {
    const { skipped } = parseReadings(textareaEl!.value);
    entryEl!.classList.toggle("is-invalid", skipped.length > 0);
    skippedEl!.textContent =
      skipped.length === 0
        ? ""
        : t(skipped.length === 1 ? "reading.skipped" : "reading.skipped_many", {
            lines: skipped.join(", "),
          });
  }

  function reflect(): void {
    textareaEl!.value = store!.get().text;
    showSkipped();
  }

  function handleInput(): void {
    store!.setText(textareaEl!.value);
    showSkipped();
  }

  // A redraw under the cursor would drop the caret, so the focused textarea keeps what is typed.
  const unsubscribe = store.subscribe(() => {
    if (document.activeElement !== textareaEl) reflect();
  });
  textareaEl.addEventListener("input", handleInput);
  reflect();

  return {
    dispose() {
      unsubscribe();
      textareaEl.removeEventListener("input", handleInput);
    },
  };
}
