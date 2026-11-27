/** change-lines.test.ts — the Settings request card's change and why lines. */

import { beforeEach, expect, it } from "vitest";
import type { SettingsChange } from "../../settings/agent-access/document";
import { ROWS } from "../../settings/agent-access/rows";
import { setLocale } from "../i18n";
import { PACER_GAP_UNIT, SCREEN_KNOB_FIELDS } from "../quick-controls/constants";
import { changeLine, whyLine } from "./change-lines";

beforeEach(() => setLocale("en"));

it.each([
  ["pace.rest", "character_menu.rest", "off", "morning", "Rest (off → Until tomorrow morning)"],
  ["pace.rest", "character_menu.rest", "focus_25", "off", "Rest (Focus 25 min → off)"],
  [
    "privacy.thread_turns",
    "threadTurns.label",
    "off",
    "every",
    "Thread turns (Off → Every message)",
  ],
  ["privacy.thread_turns", "threadTurns.label", "off", "toString", "Thread turns (Off → toString)"],
  [
    "privacy.screen_watch.prev_dwell_ms",
    "screen.prev_dwell_label",
    300_000,
    70_000,
    "Counts as an app switch after (5 min → 1 min)",
  ],
  [
    "privacy.screen_watch.settle_ms",
    "screen.settle_label",
    0,
    30_000,
    "New app settles after (Default → 30 s)",
  ],
  [
    "privacy.screen_watch.recent_cap",
    "screen.recent_cap_label",
    1,
    30,
    "Remembers up to (1 entry → 30 entries)",
  ],
  [
    "limits.tier2_max",
    "reactions.rate_tier2_label",
    0,
    3,
    "Times she speaks up per hour (Default → 3)",
  ],
  [
    "limits.proactive_gap_ms",
    "reactions.pacer_gap_label",
    300_000,
    0,
    "Wait after a conversation (5 min → 0 min)",
  ],
  [
    "privacy.screen_display",
    "screenshot.source_label",
    0,
    1,
    "Screen to send (Display 1 → Display 2)",
  ],
  [
    "privacy.screen_display",
    "screenshot.source_label",
    null,
    1,
    "Screen to send (A window or tab → Display 2)",
  ],
])("prints %s, labelled %s, from %j to %j as the settings window shows it", (path, labelKey, from, to, line) => {
  const change: SettingsChange = { path, labelKey, from, to };
  expect(changeLine(change)).toBe(line);
});

it.each([
  ["first\nsecond", "first second"],
  ["third\u2028fourth", "third fourth"],
])("prints a value %j on one line as %j", (to, text) => {
  const change: SettingsChange = { path: "x.unknown", labelKey: "screenshot.label", from: "a", to };
  expect(changeLine(change)).toBe(`Attach screenshot (a → ${text})`);
});

it("prints each duration row in the unit its settings window row uses", () => {
  const unitOf = (path: string) => ROWS.find((row) => row.path === path)?.unit;
  const drift = SCREEN_KNOB_FIELDS.filter((field) => {
    const unit = unitOf(`privacy.screen_watch.${field.key}`);
    return unit?.per !== field.unitMs || unit.suffixKey !== field.suffixKey;
  });
  expect(drift.map((field) => field.key)).toEqual([]);
  const gap = unitOf("limits.proactive_gap_ms");
  expect([gap?.per, gap?.suffixKey]).toEqual([PACER_GAP_UNIT.unitMs, PACER_GAP_UNIT.suffixKey]);
});

it.each([
  ["to see\nyour code", "“to see your code”"],
  ["a".repeat(300), `“${"a".repeat(200)}”`],
])("prints the why %j as %j, one line of at most 200 characters", (why, line) => {
  expect(whyLine(why)).toBe(line);
});
