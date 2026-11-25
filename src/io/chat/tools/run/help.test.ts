/** help.test.ts — help() prints the yui API, a settings type with one commented line per exposed row, and four rules. */

import { describe, expect, it } from "vitest";
import { ROWS } from "../../../../settings/agent-access/rows";
import { createSettingsStores } from "../../../../settings/settings-stores";
import { helpText } from "./help";

const label = (key: string) => `L(${key})`;
const text = helpText(label);

/** The type's leaves, in order: the dotted path of each `name: type;` line and the comment above it. */
function leaves(help: string) {
  const body = help.slice(help.indexOf("type SettingsDoc = {"));
  const keys: string[] = [];
  const found: { path: string; type: string; comment: string }[] = [];
  let comment = "";
  for (const line of body.split("\n").slice(1)) {
    const note = line.match(/^\s*\/\*\* (.*) \*\/$/);
    const open = line.match(/^\s*(\w+): \{$/);
    const leaf = line.match(/^\s*(\w+): (.*);$/);
    if (note) comment = note[1]!;
    else if (open) keys.push(open[1]!);
    else if (leaf) {
      found.push({ path: [...keys, leaf[1]!].join("."), type: leaf[2]!, comment });
      comment = "";
    } else if (/^\s*\};?$/.test(line)) {
      if (keys.length === 0) break;
      keys.pop();
    }
  }
  return found;
}

describe("helpText", () => {
  it("prints one line per exposed row with its label, scope, tier and type", () => {
    const found = leaves(text);

    expect(found.map((leaf) => leaf.path).sort()).toEqual(ROWS.map((row) => row.path).sort());
    const by = (path: string) => found.find((leaf) => leaf.path === path)!;
    expect(by("appearance.theme")).toEqual({
      path: "appearance.theme",
      type: '"dawn" | "hearth" | "system"',
      comment: "L(appearance.label) [global, direct]",
    });
    expect(by("voice.output")).toMatchObject({
      type: "boolean",
      comment: "L(tts_output.label) [char, direct]",
    });
    expect(by("privacy.screenshot").comment).toBe("L(screenshot.label) [global, allow]");
    expect(by("limits.tier2_max").type).toBe("number");
    expect(by("limits.tier2_max").comment).toContain("0 means YUI's default");
    expect(by("character.active_hours").type).toBe(
      '{ start: "HH:MM"; end: "HH:MM"; pace: "high" | "normal" | "low" | "off" }[] | null',
    );
  });

  it("types a row boolean exactly when its stored value is a boolean", () => {
    const stores = createSettingsStores();
    const types = new Map(leaves(text).map((leaf) => [leaf.path, leaf.type]));

    for (const row of ROWS) {
      expect(types.get(row.path) === "boolean", row.path).toBe(
        typeof row.read(stores) === "boolean",
      );
    }
  });

  it("declares the yui API and four rules, and stays under 8 KB", () => {
    expect(text).toContain("declare const yui:");
    expect(text).toContain("declare function help(): string;");
    expect(text.match(/^\d\. /gm)).toHaveLength(4);
    expect(text.length).toBeLessThan(8192);
  });
});
