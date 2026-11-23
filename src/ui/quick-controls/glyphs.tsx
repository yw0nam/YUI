/** Glyphs the settings pages render as JSX. */

import type { SettingsPage } from "../../settings/panels/settings-pages";

/** The warning glyph of an inline error line; the Connection quick start and the Plugins page share it. */
export const WARN_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
    <path d="M12 7.5v5.5M12 16.2v.1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// Rail icons — the line-icon vocabulary of the icon buttons (1.5 stroke, 24x24 viewBox); Listening reuses the voice input row's path.
export const TAB_ICONS: Record<SettingsPage, React.JSX.Element> = {
  conn: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 7.5V4M15 7.5V4M12 16.5V20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M7 7.5h10v4a5 5 0 0 1-10 0v-4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  voice: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4.5 9.5h3l4.5-3.5v12l-4.5-3.5h-3v-5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  persona: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 6.8A2.3 2.3 0 0 1 6.3 4.5h11.4A2.3 2.3 0 0 1 20 6.8v6.4a2.3 2.3 0 0 1-2.3 2.3H10l-4.3 3.3v-3.3H6.3A2.3 2.3 0 0 1 4 13.2V6.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  ),
  body: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8.3" r="3.1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5.2 19c1.15-3.4 3.9-5 6.8-5s5.65 1.6 6.8 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  hist: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8v4l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M4.5 12a7.5 7.5 0 1 1 2.2 5.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M4.5 17v-4h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  together: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="9" cy="8.5" r="2.8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 18.5c.9-2.9 3-4.3 5.5-4.3s4.6 1.4 5.5 4.3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M15.5 6.2a2.8 2.8 0 0 1 0 5.4M17.2 14.4c1.6.6 2.7 1.9 3.3 4.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  listening: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 4.5v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M8 9.5v1.8a4 4 0 0 0 8 0V9.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M12 15.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M9.5 18.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  perms: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.8 5.5 6.3v5.1c0 4.1 2.7 7.4 6.5 8.8 3.8-1.4 6.5-4.7 6.5-8.8V6.3L12 3.8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="m9.3 12 1.9 1.9 3.6-3.7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  plugins: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5 8.5h3.2a.8.8 0 0 0 .7-1.2 2.1 2.1 0 1 1 3.6 0 .8.8 0 0 0 .7 1.2H16v3.2a.8.8 0 0 0 1.2.7 2.1 2.1 0 1 1 0 3.6.8.8 0 0 0-1.2.7V19.5H5v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  ),
  react: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13 3 5.5 13h4.7l-1 8L18 11h-4.7l1-8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  ),
  motion: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="13.5" cy="5" r="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="m8 20 2.6-5 2.9 2.2V21M10.6 15l1.4-6 3.5 2.6 2.5-.8M12 9l-3.2 1.4L7.5 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  general: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line
        x1="4"
        y1="6"
        x2="20"
        y2="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <line
        x1="4"
        y1="18"
        x2="20"
        y2="18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle
        cx="8"
        cy="6"
        r="1.7"
        fill="var(--yui-panel-bg)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle
        cx="16"
        cy="12"
        r="1.7"
        fill="var(--yui-panel-bg)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle
        cx="10"
        cy="18"
        r="1.7"
        fill="var(--yui-panel-bg)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  ),
};

/** The rename and remove glyphs of a list row. */
export const RENAME_GLYPH = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const REMOVE_GLYPH = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

/** The plus of an add button, 2px stroke. */
export const PLUS_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/** The preset manage list's photo and copy-URL glyphs, and the header's manage dots. */
export const PHOTO_GLYPH = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m21 16-5-5-8 8" />
  </svg>
);
export const COPY_GLYPH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </svg>
);
export const DOTS_GLYPH = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="6" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18" cy="12" r="1.6" />
  </svg>
);
