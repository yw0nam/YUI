/** A Settings request's card prompt: lines from i18n keys, with every agent-written value as escaped plain text. */

import { oneLine } from "../../io/chat/one-line";
import type { SettingsChange } from "../../settings/agent-access/document";
import { ROWS } from "../../settings/agent-access/rows";
import { t } from "../i18n";

const WHY_MAX = 200;

/** The prompt renders as Markdown, so every ASCII punctuation mark is backslash-escaped. */
function plain(text: string): string {
  return oneLine(text).replace(/[!-/:-@[-`{-~]/g, "\\$&");
}

function value(v: unknown): string {
  return typeof v === "boolean"
    ? t(v ? "settings_request.on" : "settings_request.off")
    : plain(String(v));
}

export function settingsRequestPrompt(
  name: string,
  changes: readonly SettingsChange[],
  why?: string,
): string {
  const lines = [
    t("settings_request.title", { name: plain(name) }),
    ...changes.map((c) => `${t(c.labelKey)}: ${value(c.from)} → ${value(c.to)}`),
  ];
  if (why !== undefined && oneLine(why)) {
    lines.push(
      t("settings_request.why", { why: plain([...oneLine(why)].slice(0, WHY_MAX).join("")) }),
    );
  }
  if (changes.some((c) => ROWS.find((row) => row.path === c.path)?.scope === "global")) {
    lines.push(t("settings_request.shared"));
  }
  return lines.join("\n");
}
