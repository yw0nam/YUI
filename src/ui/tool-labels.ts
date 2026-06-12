/**
 * Tool-id → display label map.
 *
 * English by default. Structured for i18n extension: add a new locale key to
 * TOOL_LABELS and getToolLabel will pick it up automatically.
 *
 * Lookup order: TOOL_LABELS[locale][id] → TOOL_LABELS.en[id] → FALLBACK.
 */

const FALLBACK = "Working…";

/** Locale → tool-id → display label. Extend for i18n without touching core logic. */
export const TOOL_LABELS: Record<string, Record<string, string>> = {
  en: {
    web_search: "Searching…",
    browser: "Browsing…",
    terminal: "Running…",
    code: "Running…",
    file: "Reading…",
    read_file: "Reading…",
    write_file: "Writing…",
    python: "Running…",
  },
};

/**
 * Returns the display label for a given tool id and optional locale.
 * Falls back to English, then to the generic fallback if neither matches.
 */
export function getToolLabel(toolId: string, locale = "en"): string {
  const localMap = TOOL_LABELS[locale];
  if (localMap && toolId in localMap) return localMap[toolId];

  const enMap = TOOL_LABELS.en;
  if (enMap && toolId in enMap) return enMap[toolId];

  return FALLBACK;
}
