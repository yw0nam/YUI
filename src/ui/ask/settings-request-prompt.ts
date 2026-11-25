/** A Settings request's card prompt: lines from i18n keys, with every agent-written value as escaped plain text. */

import { oneLine } from "../../io/chat/one-line";
import type { SettingsChange } from "../../settings/agent-access/document";
import { ROWS, type SettingRow } from "../../settings/agent-access/rows";
import { t } from "../i18n";

const WHY_MAX = 200;

/** The prompt renders as Markdown, so every ASCII punctuation mark is backslash-escaped. */
function plain(text: string): string {
  return oneLine(text).replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

/** A value as the row's control in the settings window shows it. */
function value(row: SettingRow | undefined, v: unknown): string {
  if (typeof v === "boolean") return t(v ? "settings_request.on" : "settings_request.off");
  const label = row?.valueLabels?.[String(v)];
  if (label) return t(label);
  if (typeof v === "number" && row?.ordinalKey) return t(row.ordinalKey, { n: v + 1 });
  if (typeof v === "number" && row?.unit) {
    return t("settings_request.amount", { n: v / row.unit.per, unit: t(row.unit.suffixKey) });
  }
  return plain(String(v));
}

export function settingsRequestPrompt(
  name: string,
  changes: readonly SettingsChange[],
  why?: string,
): string {
  const lines = changes.map((c) => {
    const row = ROWS.find((r) => r.path === c.path);
    return t("settings_request.change", {
      label: t(c.labelKey),
      from: value(row, c.from),
      to: value(row, c.to),
    });
  });
  if (why !== undefined && oneLine(why)) {
    lines.push(
      t("settings_request.why", { why: plain([...oneLine(why)].slice(0, WHY_MAX).join("")) }),
    );
  }
  // Every allow-tier row is global.
  lines.push(t("settings_request.shared"));
  // The blank line makes the title the card's head block and the rest its body.
  return `${t("settings_request.title", { name: plain(name) })}\n\n${lines.join("\n")}`;
}
