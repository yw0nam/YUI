/** The Character menu's line glyphs, by the glyph id its items name. */

import { TERMINAL_GLYPH, THREADS_GLYPH } from "../threads/glyphs";

const icon = (paths: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const GAUGE = '<path d="M4.5 16.5a7.5 7.5 0 1 1 15 0"/>';
const SPEAKER = '<path d="M4 9.8h3l4.5-3.6v11.6L7 14.2H4z"/>';

export const GLYPHS: Record<string, string> = {
  talk: icon('<path d="M5 5.5h14v10.5h-8.5L6.5 19.5V16H5z"/><path d="M9 10.5h6"/>'),
  rest: icon(
    '<path d="M18.5 14.2A7 7 0 0 1 9.8 5.5a7 7 0 1 0 8.7 8.7z"/><path d="M15 4.5h3.5L15 8h3.5"/>',
  ),
  focus: icon('<circle cx="12" cy="13" r="7"/><path d="M12 13V9.5M10 3.5h4"/>'),
  end: icon(
    '<circle cx="12" cy="12" r="3.5"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
  ),
  listen: icon(
    '<path d="M12 3.8a2.6 2.6 0 0 1 2.6 2.6v4.8a2.6 2.6 0 0 1-5.2 0V6.4A2.6 2.6 0 0 1 12 3.8z"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0"/><path d="M12 16.5v3.7"/>',
  ),
  settings: icon('<path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4"/>'),
  body: icon(
    '<path d="M12 7.6a1.9 1.9 0 1 1 1.9-1.9c0 1.1-1.9 1.5-1.9 2.9"/><path d="M12 8.6 3.8 15.4h16.4z"/>',
  ),
  voice: icon(
    `${SPEAKER}<path d="M15 9.2a4 4 0 0 1 0 5.6"/><path d="M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>`,
  ),
  mute: icon(`${SPEAKER}<path d="m15.5 9.5 5 5"/><path d="m20.5 9.5-5 5"/>`),
  pace: icon(`${GAUGE}<path d="m12 16.5 3.6-4.6"/>`),
  "pace-low": icon(`${GAUGE}<path d="M12 16.5 8 12.3"/>`),
  "pace-normal": icon(`${GAUGE}<path d="M12 16.5v-5.9"/>`),
  "pace-high": icon(`${GAUGE}<path d="m12 16.5 4-4.2"/>`),
  more: icon(
    '<path d="M5 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0z"/><path d="M10.8 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0z"/><path d="M16.6 12a1.2 1.2 0 1 0 2.4 0a1.2 1.2 0 1 0-2.4 0z"/>',
  ),
  back: icon('<path d="M14.5 6.5 9 12l5.5 5.5"/>'),
  threads: THREADS_GLYPH,
  bubble: icon('<path d="M5 5.5h14v10.5h-8.5L6.5 19.5V16H5z"/><path d="m9 10.8 2 2 4-4"/>'),
  unified: icon(
    '<path d="M3.8 5h9.7v7H8l-3 2.5V12H3.8z"/><path d="M16.5 9h3.7v7H19v2.5L16 16h-5.5v-1.8"/>',
  ),
  terminal: TERMINAL_GLYPH,
  reset: icon('<path d="M5.2 12a6.8 6.8 0 1 0 2-4.8"/><path d="M5 4.5v3.7h3.7"/>'),
  off: icon('<path d="M12 4v7.5"/><path d="M7.3 6.6a7 7 0 1 0 9.4 0"/>'),
  out: icon('<path d="M13.5 5H19v5.5"/><path d="m19 5-8 8"/><path d="M17 13.5V19H5V7h5.5"/>'),
};

/** The trailing chevron on a pill that opens a list. */
export const CHEVRON = `<svg class="yui-cmenu__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 6.5 15 12l-5.5 5.5"/></svg>`;
