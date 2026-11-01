/** The Threads and Terminal glyphs, drawn in the Threads window and on the quick card that opens it. */

const glyph = (paths: string): string =>
  `<svg class="yui-threads-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

/** A tray: the Threads list. */
export const THREADS_GLYPH = glyph(
  '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
);

/** A prompt in a frame: a terminal, and the user who owns one. */
export const TERMINAL_GLYPH = glyph(
  '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3"/><path d="M12.5 15H17"/>',
);
