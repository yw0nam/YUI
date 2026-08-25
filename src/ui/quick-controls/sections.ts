/**
 * Collapsible sections — wires each panel-wide `<details class="yui-section" data-section>`
 * (open/closed state baked into the markup by template.ts before first paint) to the sections
 * store: a user toggle persists, and a remote change (other window) reflects back into the DOM.
 */
import type { createSectionsSettings } from "../../io/sections-settings";

type SectionsSettingsStore = ReturnType<typeof createSectionsSettings>;

interface SectionsDeps {
  /** Panel root (el) — query collapsible sections here. */
  root: HTMLElement;
  sectionsSettings?: SectionsSettingsStore;
}

export interface Sections {
  /** Apply the store's current closed set to the DOM (other-window reload, pet/settings sync). */
  reflect(): void;
  dispose(): void;
}

export function createSections({ root, sectionsSettings }: SectionsDeps): Sections {
  const detailsEls = Array.from(
    root.querySelectorAll<HTMLDetailsElement>("details.yui-section[data-section]"),
  );

  function handleToggle(e: Event): void {
    const details = e.currentTarget as HTMLDetailsElement;
    const id = details.dataset.section;
    if (!id) return;
    sectionsSettings?.setClosed(id, !details.open);
  }

  function reflect(): void {
    const closed = sectionsSettings?.get().closed ?? [];
    for (const details of detailsEls) {
      const id = details.dataset.section;
      if (!id) continue;
      const shouldBeOpen = !closed.includes(id);
      if (details.open !== shouldBeOpen) details.open = shouldBeOpen;
    }
  }

  for (const details of detailsEls) details.addEventListener("toggle", handleToggle);

  function dispose(): void {
    for (const details of detailsEls) details.removeEventListener("toggle", handleToggle);
  }

  return { reflect, dispose };
}
