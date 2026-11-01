/** The quick card's way into the Threads window: one button per tab, which opens the window on that tab. */

import type { ThreadsTab } from "../../io/bridge/settings-bridge";
import { t } from "../i18n";
import { TERMINAL_GLYPH, THREADS_GLYPH } from "../threads/glyphs";

const BUTTONS = [
  {
    tab: "threads",
    glyph: THREADS_GLYPH,
    labelKey: "threads.title",
    ariaKey: "quick_card.open_threads",
  },
  {
    tab: "terminal",
    glyph: TERMINAL_GLYPH,
    labelKey: "terminal.title",
    ariaKey: "quick_card.open_terminal",
  },
] as const;

export function createThreadsButtons(open: (tab: ThreadsTab) => void): HTMLElement {
  const el = document.createElement("div");
  el.className = "yui-qcard__opens";
  for (const { tab, glyph, labelKey, ariaKey } of BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-qcard__open";
    button.innerHTML = glyph;
    button.append(t(labelKey));
    button.setAttribute("aria-label", t(ariaKey));
    button.addEventListener("click", () => open(tab));
    el.append(button);
  }
  return el;
}
