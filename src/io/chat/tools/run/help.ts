/** The text help() prints inside a script: the yui API, the settings document generated from the rows, the usage rules. */

import { getIn } from "../../../../settings/agent-access/paths";
import { ROWS, type SettingRow, union } from "../../../../settings/agent-access/rows";

/** What help() prints per row; the io selection rows satisfy it too. */
export type HelpRow = Pick<
  SettingRow,
  | "path"
  | "scope"
  | "access"
  | "labelKey"
  | "type"
  | "values"
  | "valueLabels"
  | "min"
  | "max"
  | "integer"
  | "maxLength"
  | "zeroIsDefault"
  | "zeroNote"
  | "note"
>;

// Where an io-owned value's ids come from; the settings layer cannot name the tool.
const IO_NOTES: Record<string, string> = {
  "privacy.screen_display": "index from yui.info.read().monitors",
};

const API = `declare const yui: {
  settings: {
    /** This character's settings and the global ones, as one JSON document. */
    read(): Promise<SettingsDoc>;
    /** JSON merge patch (RFC 7396) on that document; list rows take the whole list, null resets character.active_hours; a non-object patch or non-string why answers { "*": "error: ..." }; allow paths wait for the user, 60 s once the card shows. */
    write(patch: object, opts?: { why?: string }): Promise<Record<string, "ok" | "denied" | "no answer" | \`error: \${string}\`>>;
  };
  state: { read(): Promise<{ running_since: string; last_together: string | null; characters: { name: string; open: boolean; me: boolean }[]; permissions: { screen_recording: "granted" | "denied" | "unknown" } }> };
  info: { read(): Promise<{ bodies: { id: string; label: string }[]; voices: { id: string; label: string }[]; monitors: { index: number; name?: string; width?: number; height?: number }[] }> };
};
declare function help(): string;
declare const console: { log(...a: unknown[]): void };
`;

const LEGEND =
  "// [char|global, direct|allow]: char = this character, global = every character; direct = written at once, allow = waits for the user, 60 s once the card shows.\n";

const RULES = `1. Await every yui call; the returned value is the tool result.
2. Return a JSON value the model reads; no prose around it.
3. One write per intent, with a why the user reads on the request card.
4. Rows marked allow wait for the user; denied or no answer changes nothing.
`;

function typeOf(row: SettingRow | HelpRow): string {
  if (row.type) return row.type;
  if (row.values) return union(row.values);
  if (row.valueLabels) return union(Object.keys(row.valueLabels));
  if ("factory" in row && row.field) {
    const value = getIn(row.factory({ load: () => ({}), save() {} }).get(), row.field);
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value)) return "string[]";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
  }
  return "string";
}

function commentOf(row: SettingRow | HelpRow, t: (key: string) => string): string {
  let comment = `${t(row.labelKey)} [${row.scope}, ${row.access}]`;
  if (row.note) comment += `; ${row.note}`;
  if (row.zeroNote) comment += `; ${row.zeroNote}`;
  else if (row.zeroIsDefault) comment += "; 0 means YUI's default";
  if (row.min !== undefined && row.max !== undefined) {
    comment += `; ${row.min}..${row.max}${row.integer ? " integer" : ""}`;
  }
  if (row.maxLength !== undefined) comment += `; up to ${row.maxLength} characters`;
  const ioNote = IO_NOTES[row.path];
  if (ioNote) comment += `; ${ioNote}`;
  return comment;
}

type Branch = Map<string, Branch | { row: SettingRow | HelpRow }>;

function emit(branch: Branch, indent: string, out: string[], t: (key: string) => string): void {
  for (const [name, child] of branch) {
    if (child instanceof Map) {
      out.push(`${indent}${name}: {`);
      emit(child, `${indent}  `, out, t);
      out.push(`${indent}};`);
      continue;
    }
    out.push(`${indent}/** ${commentOf(child.row, t)} */`);
    out.push(`${indent}${name}: ${typeOf(child.row)};`);
  }
}

function settingsType(t: (key: string) => string, extra: readonly HelpRow[]): string {
  const rows: readonly (SettingRow | HelpRow)[] = extra.length ? [...ROWS, ...extra] : ROWS;
  const root: Branch = new Map();
  for (const row of rows) {
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

export function helpText(t: (key: string) => string, extra: readonly HelpRow[] = []): string {
  return `${API}${LEGEND}${settingsType(t, extra)}\n${RULES}`;
}
