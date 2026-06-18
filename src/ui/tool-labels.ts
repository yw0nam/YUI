/**
 * Tool-id → display label lookup.
 *
 * Delegates to the i18n dictionary (tool.<id> keys, English in every locale).
 * Unknown tool ids fall back to a generic "Working…" label.
 */

import { t } from "./i18n";

const FALLBACK = "Working…";

/**
 * Returns the display label for a given tool id and optional locale.
 * The locale argument is accepted for call-site compatibility; tool labels are
 * English in every locale, so the i18n lookup resolves the same value regardless.
 * Falls back to the generic label when the tool id is unknown.
 */
export function getToolLabel(toolId: string, _locale?: string): string {
  if (!toolId) return FALLBACK;
  const key = `tool.${toolId}`;
  const value = t(key);
  return value === key ? FALLBACK : value;
}
