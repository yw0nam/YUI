/** A Settings request's lines from i18n keys, each agent-written value as one line of plain text. */

import { oneLine } from "../../io/chat/one-line";
import type { SettingsChange } from "../../settings/agent-access/document";
import { ROWS, type SettingRow } from "../../settings/agent-access/rows";
import { t } from "../i18n";

// A why is one sentence; 200 code points keep the card readable at a glance, as the push placeholder cap does.
const WHY_MAX = 200;

/** A value as the row's control in the settings window shows it. */
function value(row: SettingRow | undefined, v: unknown): string {
  if (typeof v === "boolean") return t(v ? "settings_request.on" : "settings_request.off");
  if (v === null) return t(row?.nullKey ?? "settings_request.none");
  if (row?.valueLabels && Object.hasOwn(row.valueLabels, String(v))) {
    return t(row.valueLabels[String(v)]!);
  }
  if (typeof v !== "number" || !row) return oneLine(String(v));
  if (v === 0 && row.zeroIsDefault) return t("settings_request.default");
  if (row.ordinalKey) return t(row.ordinalKey, { n: v + 1 });
  if (!row.unit) return String(v);
  const n = Math.round(v / row.unit.per);
  const unit = t(n === 1 && row.unit.oneKey ? row.unit.oneKey : row.unit.suffixKey);
  return t("settings_request.amount", { n, unit });
}

/** One change as "label (from → to)". */
export function changeLine(change: SettingsChange): string {
  const row = ROWS.find((r) => r.path === change.path);
  return t("settings_request.change", {
    label: t(change.labelKey),
    from: value(row, change.from),
    to: value(row, change.to),
  });
}

/** The agent's why, quoted on one line; null when it says nothing. */
export function whyLine(why: string | undefined): string | null {
  const line = oneLine(why ?? "");
  return line ? t("settings_request.why", { why: [...line].slice(0, WHY_MAX).join("") }) : null;
}
