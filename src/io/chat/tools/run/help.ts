/** The text help() prints inside a script: the yui API, the settings document generated from the table, the usage rules. */

import { FILLER_LANGS } from "../../../../config/validators/filler";
import { PACES } from "../../../../settings/active-hours/spans";
import { getIn } from "../../../../settings/agent-access/paths";
import type { SettingRow } from "../../../../settings/agent-access/rows";
import { ROWS } from "../../../../settings/agent-access/rows";
import { TEXT_SIZES } from "../../../../settings/appearance/text-size-settings";
import { THEMES } from "../../../../settings/appearance/theme-settings";
import { REASONING_EFFORTS } from "../../../../settings/backend/agent-settings";
import {
  REACTION_COUNTS,
  REACTION_WAITS,
} from "../../../../settings/threads/thread-reaction-thresholds-settings";

const API = `declare const yui: {
  settings: {
    read(): Promise<SettingsDoc>;
    write(patch: object, opts?: { why?: string }): Promise<Record<string, "ok" | "denied" | "no answer" | \`error: \${string}\`>>;
  };
  state: { read(): Promise<{ running_since: string; last_together: string | null; characters: { name: string; open: boolean; me: boolean }[]; permissions: { screen_recording: "granted" | "denied" | "unknown" } }> };
  info: { read(): Promise<{ bodies: { id: string; label: string }[]; voices: { id: string; label: string }[]; monitors: { index: number; name?: string; width: number; height: number }[] }> };
};
declare function help(): string;
declare const console: { log(...a: unknown[]): void };
`;

const RULES = `1. Await every yui call; the returned value is the tool result.
2. Return a JSON value the model reads; no prose around it.
3. One write per intent, with a why the user reads on the request card.
4. Rows marked allow wait for the user; denied or no answer changes nothing.
`;

const union = (values: readonly unknown[]): string =>
  values.map((value) => (typeof value === "string" ? `"${value}"` : String(value))).join(" | ");

// Vocabularies the rows carry no valueLabels for, named from each store's own list.
const ENUM_TYPES: Record<string, string> = {
  "voice.filler.language": union(FILLER_LANGS),
  "character.reasoning_effort": union(REASONING_EFFORTS),
  "character.active_hours": `{ start: "HH:MM"; end: "HH:MM"; pace: ${union(PACES)} }[] | null`,
  "appearance.theme": union(THEMES),
  "appearance.text_size": union(TEXT_SIZES),
  "pace.base": union(PACES.filter((pace) => pace !== "off")),
  "threads.reaction_count": union(REACTION_COUNTS),
  "threads.reaction_wait_min": union(REACTION_WAITS),
  "privacy.screen_display": "number | null",
};

function typeOf(row: SettingRow): string {
  const value = getIn(row.factory({ load: () => ({}), save() {} }).get(), row.field);
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) return "string[]";
  if (row.valueLabels) return union(Object.keys(row.valueLabels));
  return ENUM_TYPES[row.path] ?? (typeof value === "number" ? "number" : "string");
}

type Branch = Map<string, Branch | { row: SettingRow }>;

function emit(branch: Branch, indent: string, out: string[], t: (key: string) => string): void {
  for (const [name, child] of branch) {
    if (child instanceof Map) {
      out.push(`${indent}${name}: {`);
      emit(child, `${indent}  `, out, t);
      out.push(`${indent}};`);
      continue;
    }
    const note =
      `${t(child.row.labelKey)} [${child.row.scope}, ${child.row.tier}]` +
      (child.row.zeroIsDefault ? "; 0 means YUI's default" : "");
    out.push(`${indent}/** ${note} */`);
    out.push(`${indent}${name}: ${typeOf(child.row)};`);
  }
}

function settingsType(t: (key: string) => string): string {
  const root: Branch = new Map();
  for (const row of ROWS) {
    const keys = row.path.split(".");
    let branch = root;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      const next = branch.get(key);
      if (next instanceof Map) {
        branch = next;
      } else {
        const fresh: Branch = new Map();
        branch.set(key, fresh);
        branch = fresh;
      }
    }
    branch.set(keys[keys.length - 1]!, { row });
  }
  const out: string[] = ["type SettingsDoc = {"];
  emit(root, "  ", out, t);
  out.push("};");
  return out.join("\n");
}

export function helpText(t: (key: string) => string): string {
  return `${API}${settingsType(t)}\n${RULES}`;
}
