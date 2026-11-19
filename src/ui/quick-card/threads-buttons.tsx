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

export function ThreadsButtons({ open }: { open: (tab: ThreadsTab) => void }) {
  return (
    <div className="yui-qcard__opens">
      {BUTTONS.map(({ tab, glyph, labelKey, ariaKey }) => (
        <button
          key={tab}
          type="button"
          className="yui-qcard__open"
          aria-label={t(ariaKey)}
          onClick={() => open(tab)}
        >
          {/* The glyph is a shared markup string; a display: contents host keeps it the button's flex child. */}
          <span
            className="yui-qcard__glyph"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: a constant glyph shared with the Threads window
            dangerouslySetInnerHTML={{ __html: glyph }}
          />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}
