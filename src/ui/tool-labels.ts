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
 * Unmapped ids are humanized (snake_case → "Title case…", an mcp__<server>__<tool>
 * id by its tool name alone); empty/separator-only ids fall back to the generic label.
 */
export function getToolLabel(toolId: string, _locale?: string): string {
  if (!toolId) return FALLBACK;
  const key = `tool.${toolId}`;
  const value = t(key);
  if (value !== key) return value;
  return humanize(toolId);
}

function humanize(toolId: string): string {
  // Hermes names MCP tools mcp__<server>__<tool>; the chip shows what is being done, not where.
  const parts = toolId.split("__");
  const name = parts[0] === "mcp" ? (parts.at(-1) ?? "") : toolId;
  const spaced = name.replace(/_/g, " ").trim();
  if (!spaced) return FALLBACK;
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)}…`;
}
