/**
 * Tool-id → display label lookup.
 *
 * Delegates to the i18n dictionary (tool.<id> keys, English in every locale).
 * Unmapped tool ids are humanized from the id itself; empty ids fall back to a
 * generic "Working…" label.
 */

import { t } from "./i18n";

const FALLBACK = "Working…";

/**
 * Returns the display label for a given tool id and optional locale.
 * The locale argument is accepted for call-site compatibility; tool labels are
 * English in every locale, so the i18n lookup resolves the same value regardless.
 * Unmapped ids are humanized (snake_case → "Title case…"); empty/separator-only
 * ids fall back to the generic label.
 */
export function getToolLabel(toolId: string, _locale?: string): string {
  if (!toolId) return FALLBACK;
  const key = `tool.${toolId}`;
  const value = t(key);
  if (value !== key) return value;
  return humanize(toolId);
}

function humanize(toolId: string): string {
  const spaced = toolId.replace(/_/g, " ").trim();
  if (!spaced) return FALLBACK;
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}…`;
}
