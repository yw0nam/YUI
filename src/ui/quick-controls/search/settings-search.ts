/**
 * Settings search: the field over the rail. A row matches when every whitespace-separated term of
 * the query, case-folded, is in its shown label and sub-line; a section head is a row of its title,
 * its switch, its button and the note under it. While a query is set each rail
 * item shows its page's match count, a page with none dims, and matching rows carry `.is-match`.
 * Escape on a set query or an empty field restores everything.
 */

import "./settings-search.css";
import { t } from "../../i18n";

const ROWS = ".yui-row, .yui-stack, .yui-gain, .yui-sec__head";
const TEXTS =
  ".yui-row__label, .yui-input-row__label, .yui-gain__label, .yui-row__sub, .yui-input-row__sub, .yui-gain__sub, .yui-sec__title, .yui-sec__head .yui-link-btn";

export function settingsSearchHtml(): string {
  return `<input class="yui-search__input" type="search" placeholder="${t("search.placeholder")}" aria-label="${t("search.placeholder")}" autocomplete="off" spellcheck="false" />`;
}

/** Binds the field rendered under `root` to the rail's tabs and their panels. */
export function bindSettingsSearch(root: HTMLElement): () => void {
  const input = root.querySelector<HTMLInputElement>(".yui-search__input")!;
  const tabs = [...root.querySelectorAll<HTMLButtonElement>(".yui-tab")];
  for (const tab of tabs) {
    tab.insertAdjacentHTML("beforeend", `<span class="yui-tab__count" hidden></span>`);
  }

  // Inside the page: its own panel is hidden while another page shows, so it does not count.
  const shown = (el: Element, panel: Element): boolean => {
    const hidden = el.closest("[hidden]");
    return !hidden || hidden === panel;
  };

  // Read at query time, so lists that render after the panel opens are found too.
  function rowText(row: Element, panel: Element): string {
    const note = row.matches(".yui-sec__head") ? row.nextElementSibling : null;
    const parts = [
      ...[...row.querySelectorAll(TEXTS)]
        .filter((el) => shown(el, panel))
        .map((el) => el.textContent),
      ...[...row.querySelectorAll(".yui-sec__head [role=switch]")].map((el) =>
        el.getAttribute("aria-label"),
      ),
      note?.matches(".yui-sec__note") && shown(note, panel) ? note.textContent : "",
    ];
    return parts.join(" ").toLocaleLowerCase();
  }

  function apply(): void {
    for (const row of root.querySelectorAll(".is-match")) row.classList.remove("is-match");
    const terms = input.value.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for (const tab of tabs) {
      const badge = tab.querySelector<HTMLElement>(".yui-tab__count")!;
      const panel = root.querySelector(`#${tab.getAttribute("aria-controls")}`);
      if (terms.length === 0 || !panel) {
        badge.hidden = true;
        tab.classList.remove("is-dim");
        continue;
      }
      const matches = [...panel.querySelectorAll(ROWS)].filter((row) => {
        const text = rowText(row, panel);
        return text !== "" && terms.every((term) => text.includes(term));
      });
      for (const row of matches) row.classList.add("is-match");
      badge.textContent = String(matches.length);
      badge.hidden = false;
      tab.classList.toggle("is-dim", matches.length === 0);
    }
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || input.value === "") return;
    // The query clears first; the next Escape reaches the panel.
    e.stopPropagation();
    input.value = "";
    apply();
  }

  input.addEventListener("input", apply);
  input.addEventListener("keydown", handleKeydown);
  return () => {
    input.removeEventListener("input", apply);
    input.removeEventListener("keydown", handleKeydown);
  };
}
