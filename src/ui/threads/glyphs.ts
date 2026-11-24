/** The Threads and Terminal glyphs, drawn in the Threads window and in the Character menu that opens it. */

/** A 24px line glyph's attributes, as React names them; they draw it without a stylesheet. */
export const GLYPH_ATTRS = {
  className: "yui-threads-glyph",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.5",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": "true",
} as const;

/** An attribute's markup name: `class`, `viewBox` as it is, the rest in kebab case. */
const markupName = (name: string): string =>
  name === "className"
    ? "class"
    : name === "viewBox"
      ? name
      : name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** A 24px line glyph's markup around `paths`. */
export const glyph = (paths: string): string =>
  `<svg ${Object.entries(GLYPH_ATTRS)
    .map(([name, value]) => `${markupName(name)}="${value}"`)
    .join(" ")}>${paths}</svg>`;

/** A tray: the Threads list. */
export const THREADS_PATHS =
  '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>';
export const THREADS_GLYPH = glyph(THREADS_PATHS);

/** A prompt in a frame: a terminal, and the user who owns one. */
export const TERMINAL_GLYPH = glyph(
  '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3"/><path d="M12.5 15H17"/>',
);

/** A check mark: a picked choice or a read Thread. */
export const CHECK_PATHS = '<path d="M5 12.5 9.5 17 19 7"/>';
export const CHECK_SVG = glyph(CHECK_PATHS);
