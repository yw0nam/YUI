/** The quick card's way into the Threads window: one button per tab, which opens the window on that tab. */

import type { ThreadsTab } from "../../io/bridge/settings-bridge";
import { TERMINAL_GLYPH, THREADS_GLYPH } from "../threads/glyphs";
import { tr } from "./locale";

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

export function ThreadsButtons(props: { open: (tab: ThreadsTab) => void }) {
  return (
    <div class="yui-qcard__opens">
      {BUTTONS.map(({ tab, glyph, labelKey, ariaKey }) => (
        <button
          type="button"
          class="yui-qcard__open"
          aria-label={tr(ariaKey)}
          ref={(button) => button.insertAdjacentHTML("afterbegin", glyph)}
          onClick={() => props.open(tab)}
        >
          {tr(labelKey)}
        </button>
      ))}
    </div>
  );
}
