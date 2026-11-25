/** A Settings request's card prompt: lines from i18n keys, with every agent-written value as escaped plain text. */

import { oneLine } from "../../io/chat/one-line";
import type { SettingsChange } from "../../settings/agent-access/document";
import { ROWS, type SettingRow } from "../../settings/agent-access/rows";
import { t } from "../i18n";

// A why is one sentence; 200 code points keep the card readable at a glance, as the push placeholder cap does.
const WHY_MAX = 200;

/** The prompt renders as Markdown, so every ASCII punctuation mark is backslash-escaped. */
function plain(text: string): string {
  return oneLine(text).replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

/** A value as the row's control in the settings window shows it. */
function value(row: SettingRow | undefined, v: unknown): string {
  if (typeof v === "boolean") return t(v ? "settings_request.on" : "settings_request.off");
  if (v === null) return t(row?.nullKey ?? "settings_request.none");
  if (row?.valueLabels && Object.hasOwn(row.valueLabels, String(v))) {
    return t(row.valueLabels[String(v)]!);
  }
  if (typeof v !== "number" || !row) return plain(String(v));
  if (v === 0 && row.zeroIsDefault) return t("settings_request.default");
  if (row.ordinalKey) return t(row.ordinalKey, { n: v + 1 });
  if (!row.unit) return String(v);
  const n = Math.round(v / row.unit.per);
  const unit = t(n === 1 && row.unit.oneKey ? row.unit.oneKey : row.unit.suffixKey);
  return t("settings_request.amount", { n, unit });
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
