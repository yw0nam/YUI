/** help.test.ts — help() prints the yui API, a settings type with one literal line per exposed row, and eight rules. */

import { describe, expect, expectTypeOf, it } from "vitest";
import { createGuideApi } from "../../../guide/guide-docs";
import type { McpHost } from "../../../mcp-host/mcp-host";
import { createLookApi } from "../avatar";
import { createPluginsApi } from "../plugins/plugins-api";
import { createTerminalApi } from "../terminal/terminal-api";
import { createThreadsApi } from "../threads/threads-api";
import { helpText } from "./help";
import type { InfoDoc } from "./info-api";
import { type SelectionPort, selectionRows } from "./selection-rows";
import type { WriteResults } from "./settings-api";
import type { StateDoc } from "./state-api";

const label = (key: string) => `L(${key})`;
const pick = (id: string): SelectionPort => ({
  list: () => [{ id }],
  getActiveId: () => id,
  swap: async () => {},
});
const rows = selectionRows({ vrm: pick("yui"), speaker: pick("soft") });
const text = helpText(label, rows);
/** The namespace blocks merged so far, in help()'s order. */
const declarations = [
  createGuideApi().declaration,
  createTerminalApi({ presetId: () => null, invoke: async () => "" }).declaration,
  createPluginsApi({ host: {} as McpHost, presetId: () => "" }).declaration,
  createLookApi(() => null).declaration,
  createThreadsApi({ threads: () => [] }).declaration,
];
/** The main window's help() text, whose size the budget pins. */
const main = helpText(label, rows, declarations);
const joined = helpText(label, rows, ["  a: {};", "  b: {};"]);

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
  it("prints one literal line for every exposed row, in document order", () => {
    expect(leaves(text)).toEqual([
      { path: "voice.output", type: "boolean", comment: "L(tts_output.label) [char, direct]" },
      {
        path: "voice.one_at_a_time",
        type: "boolean",
        comment: "L(one_voice.label) [global, direct]",
      },
      {
        path: "voice.filler.enabled",
        type: "boolean",
        comment: "L(filler.enable_label) [char, direct]",
      },
      {
        path: "voice.filler.language",
        type: '"ja" | "en" | "ko"',
        comment: "L(filler.lang_label) [char, direct]",
      },
      {
        path: "voice.readings",
        type: "string",
        comment:
          "L(reading.section) [global, direct]; one surface=reading per line; up to 16384 characters",
      },
      {
        path: "voice_input.silence_ms",
        type: "number",
        comment: "L(voice_input.silence_label) [global, direct]; 500..3000",
      },
      {
        path: "voice_input.barge_in",
        type: "boolean",
        comment: "L(voice_input.bargein_label) [global, direct]",
      },
      {
        path: "character.reasoning_effort",
        type: '"default" | "none" | "minimal" | "low" | "medium"',
        comment: "L(reasoning.label) [char, direct]",
      },
      {
        path: "character.active_hours",
        type: '{ start: "HH:MM"; end: "HH:MM"; pace: "high" | "normal" | "low" | "off" }[] | null',
        comment: "L(active_hours.label) [char, direct]",
      },
      {
        path: "character.body",
        type: "string",
        comment: "L(run.body_label) [char, direct]; id from yui.info.read().bodies",
      },
      {
        path: "character.voice",
        type: "string",
        comment: "L(run.voice_label) [char, direct]; id from yui.info.read().voices",
      },
      {
        path: "user.name",
        type: "string",
        comment:
          "L(card.user_name) [global, direct]; no leading or trailing spaces; up to 64 characters",
      },
      {
        path: "appearance.theme",
        type: '"dawn" | "hearth" | "system"',
        comment: "L(appearance.label) [global, direct]",
      },
      {
        path: "appearance.text_size",
        type: "0.9 | 1 | 1.125 | 1.25 | 1.4",
        comment: "L(textsize.label) [global, direct]",
      },
      { path: "bubble.keep", type: "boolean", comment: "L(bubble_persist.label) [global, direct]" },
      { path: "body.gaze", type: "boolean", comment: "L(gaze.label) [global, direct]" },
      { path: "body.climb", type: "boolean", comment: "L(climb.label) [global, direct]" },
      { path: "body.fall", type: "boolean", comment: "L(fall.label) [global, direct]" },
      {
        path: "body.mouth_gain",
        type: "number",
        comment: "L(expression.mouth_label) [global, direct]; 0.5..6",
      },
      {
        path: "pace.base",
        type: '"high" | "normal" | "low"',
        comment: "L(base_pace.title) [global, direct]",
      },
      { path: "pace.rest", type: "boolean", comment: "L(character_menu.rest) [global, allow]" },
      {
        path: "threads.reactions",
        type: "boolean",
        comment: "L(threadReactions.label) [global, direct]",
      },
      {
        path: "threads.reaction_count",
        type: "0 | 2 | 3 | 5",
        comment: "L(threadReactionThresholds.count_label) [global, direct]",
      },
      {
        path: "threads.reaction_wait_min",
        type: "0 | 5 | 10 | 30",
        comment: "L(threadReactionThresholds.wait_label) [global, direct]",
      },
      {
        path: "relations.enabled",
        type: "boolean",
        comment: "L(relations.section) [global, direct]",
      },
      {
        path: "unified_chat",
        type: "boolean",
        comment: "L(unified.enable_label) [global, direct]",
      },
      {
        path: "performance.idle_throttle",
        type: "boolean",
        comment: "L(perf.idle_label) [global, direct]",
      },
      {
        path: "privacy.screenshot",
        type: "boolean",
        comment: "L(screenshot.label) [global, allow]",
      },
      {
        path: "privacy.screen_requests",
        type: "boolean",
        comment: "L(screenshot.request_label) [global, allow]",
      },
      {
        path: "privacy.screen_display",
        type: "number | null",
        comment:
          "L(screenshot.source_label) [global, allow]; null means a window or tab source and cannot be written; index from yui.info.read().monitors",
      },
      {
        path: "privacy.screen_watch.enabled",
        type: "boolean",
        comment: "L(screen.label) [global, allow]",
      },
      {
        path: "privacy.screen_watch.prev_dwell_ms",
        type: "number",
        comment:
          "L(screen.prev_dwell_label) [global, allow]; 0 means YUI's default; 0..86400000 integer",
      },
      {
        path: "privacy.screen_watch.settle_ms",
        type: "number",
        comment:
          "L(screen.settle_label) [global, allow]; 0 means YUI's default; 0..86400000 integer",
      },
      {
        path: "privacy.screen_watch.long_session_ms",
        type: "number",
        comment:
          "L(screen.long_session_label) [global, allow]; 0 means YUI's default; 0..86400000 integer",
      },
      {
        path: "privacy.screen_watch.recent_cap",
        type: "number",
        comment: "L(screen.recent_cap_label) [global, allow]; 0 means YUI's default; 0..20 integer",
      },
      {
        path: "privacy.external_signals",
        type: "boolean",
        comment: "L(agentNotify.label) [global, allow]",
      },
      {
        path: "privacy.thread_turns",
        type: '"off" | "notable" | "every"',
        comment: "L(threadTurns.label) [global, allow]",
      },
      {
        path: "limits.tier2_max",
        type: "number",
        comment:
          "L(reactions.rate_tier2_label) [global, allow]; 0 means YUI's default; 0..999 integer",
      },
      {
        path: "limits.urgent_max",
        type: "number",
        comment:
          "L(reactions.rate_urgent_label) [global, allow]; 0 means YUI's default; 0..999 integer",
      },
      {
        path: "limits.addressed_chain_max",
        type: "number",
        comment:
          "L(reactions.rate_addressed_label) [global, allow]; 0 means YUI's default; 0..999 integer",
      },
      {
        path: "limits.proactive_gap_ms",
        type: "number",
        comment:
          "L(reactions.pacer_gap_label) [global, allow]; 0 turns the wait off; 0..10800000 integer",
      },
    ]);
  });

  it("prints the tag legend and the read and write docs", () => {
    expect(text).toContain(
      "// [char|global, direct|allow]: char = this character, global = every character; direct = written at once, allow = waits for the user, 60 s once the card shows.",
    );
    expect(text).toContain(
      "/** This character's settings and the global ones, as one JSON document. */",
    );
    expect(text).toContain(
      '/** JSON merge patch (RFC 7396) on that document; list rows take the whole list, null resets character.active_hours; a non-object patch or non-string why answers { "*": "error: ..." }; allow paths wait for the user, 60 s once the card shows. */',
    );
    expect(text).toContain(
      `write(patch: object, opts?: { why?: string }): Promise<Record<string, "ok" | "denied" | "no answer" | \`ok: \${string}\` | \`denied: \${string}\` | \`error: \${string}\`>>;`,
    );
    expect(text).toContain(
      "monitors: { index: number; name?: string; width?: number; height?: number }[]",
    );
    expect(text).toContain(
      '{ running_since: string; last_together: string | null; characters: { name: string; open: boolean; me: boolean }[]; permissions: { screen_recording: "granted" | "denied" | "unknown" } }',
    );

    // The printed shapes cannot drift from the real docs.
    expectTypeOf<StateDoc>().toEqualTypeOf<{
      running_since: string;
      last_together: string | null;
      characters: { name: string; open: boolean; me: boolean }[];
      permissions: { screen_recording: "granted" | "denied" | "unknown" };
    }>();
    expectTypeOf<InfoDoc>().toEqualTypeOf<{
      bodies: { id: string; label: string }[];
      voices: { id: string; label: string }[];
      monitors: { index: number; name?: string; width?: number; height?: number }[];
    }>();
    expectTypeOf<WriteResults>().toEqualTypeOf<
      Record<
        string,
        "ok" | "denied" | "no answer" | `ok: ${string}` | `denied: ${string}` | `error: ${string}`
      >
    >();
  });

  it("declares the window's namespaces inside yui, then the image handle, help and console", () => {
    expect(joined).toContain(
      "  info: { read(): Promise<{ bodies: { id: string; label: string }[]; voices: { id: string; label: string }[]; monitors: { index: number; name?: string; width?: number; height?: number }[] }> };\n  a: {};\n  b: {};\n};\n",
    );
    expect(joined).toContain(
      `};\n/** An image a yui call made; it reaches the model only when the returned value holds it. */\ntype ImageHandle = { image: number };\ndeclare function help(topic?: \`plugin:\${string}\`): Promise<string>;\ndeclare const console: { log(...a: unknown[]): void };\n`,
    );
  });

  it("declares the yui API and eight rules, and stays under 9,472 bytes", () => {
    expect(main).toContain("declare const yui:");
    expect(main).not.toContain("declare function help(): string;");
    expect(main).toContain(
      "3. Put every setting that needs Allow into one write, with a why the user reads on the card; a second such write while one waits answers an error.",
    );
    expect(main).toContain("under writes");
    expect(main).toContain(
      "6. After denied or no answer, tell the user in your own words and do not repeat the same write in this turn. Text after ok: or denied: is the user's note to you.",
    );
    expect(main).toContain(
      "7. Await one call that waits for the user's Allow (a write with allow rows, terminal.read, terminal.write) before you start another.",
    );
    expect(main).toContain(
      "8. A yui call that fails returns its error text; only a wrong argument throws.",
    );
    expect(main.match(/^\d\. /gm)).toHaveLength(8);
    expect(new TextEncoder().encode(main).length).toBeLessThan(9472);
  });
});
