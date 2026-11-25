// @vitest-environment jsdom
/** settings-request-prompt.test.ts — the Settings request card's prompt as the card renders it. */

import { beforeEach, expect, it } from "vitest";
import type { SettingsChange } from "../../settings/agent-access/document";
import { ROWS } from "../../settings/agent-access/rows";
import { setLocale } from "../i18n";
import { PACER_GAP_UNIT, SCREEN_KNOB_FIELDS } from "../quick-controls/constants";
import { entryMarkdown } from "../threads/window/entry-markdown";
import { settingsRequestPrompt } from "./settings-request-prompt";

const SCREENSHOT: SettingsChange = {
  path: "privacy.screenshot",
  labelKey: "screenshot.label",
  from: false,
  to: true,
};

/** The prompt rendered the way the Ask card renders it. */
function render(prompt: string): HTMLElement {
  const el = document.createElement("div");
  el.append(...entryMarkdown(prompt));
  return el;
}
const blocks = (el: HTMLElement) => [...el.children].map((b) => b.textContent);

beforeEach(() => setLocale("en"));

it("heads the prompt with the title and puts the changes, the why and the shared line in the body", () => {
  const el = render(
    settingsRequestPrompt(
      "Rin",
      [
        SCREENSHOT,
        { path: "limits.tier2_max", labelKey: "reactions.rate_tier2_label", from: 3, to: 5 },
      ],
      "to see your code",
    ),
  );
  expect(blocks(el)).toEqual([
    "Rin wants to change settings",
    "Attach screenshot (off → on)\nTimes she speaks up per hour (3 → 5)\n“to see your code”\nApplies to every character",
  ]);
});

it.each([
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
    "Counts as an app switch after (5 min → 1.2 min)",
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
    "Screen to send (None → Display 2)",
  ],
])("prints %s, labelled %s, from %j to %j as the settings window shows it", (path, labelKey, from, to, line) => {
  const el = render(settingsRequestPrompt("Rin", [{ path, labelKey, from, to }]));
  expect(blocks(el)[1]?.split("\n")[0]).toBe(line);
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

const HOSTILE: readonly (readonly [string, string])[] = [
  ["<img src=x onerror=alert(1)>", "<img src=x onerror=alert(1)>"],
  ["<script>alert(1)</script>", "<script>alert(1)</script>"],
  ["[x](javascript:alert(1))", "[x](javascript:alert(1))"],
  ["<https://e.example/x>", "<https://e.example/x>"],
  ["see https://e.example/x", "see https://e.example/x"],
  ["![x](https://e.example/x.png)", "![x](https://e.example/x.png)"],
  ["# heading", "# heading"],
  ["```js\nalert(1)\n```", "```js alert(1) ```"],
  ["`code`", "`code`"],
  ["first\nsecond", "first second"],
  ["third\u2028fourth", "third fourth"],
];

it.each(
  HOSTILE.flatMap(
    ([input, text]) =>
      [
        ["why", input, 1, `“${text}”`],
        ["name", input, 0, `${text} wants to change settings`],
        ["value", input, 1, `Attach screenshot (old → ${text})`],
      ] as const,
  ),
)("prints a hostile %s %j as plain text", (field, input, block, expected) => {
  const change: SettingsChange =
    field === "value"
      ? { path: "x.unknown", labelKey: "screenshot.label", from: "old", to: input }
      : SCREENSHOT;
  const el = render(
    settingsRequestPrompt(
      field === "name" ? input : "Rin",
      [change],
      field === "why" ? input : undefined,
    ),
  );
  expect([...el.querySelectorAll("*")].map((n) => n.tagName)).toEqual(["P", "P"]);
  expect(blocks(el)[block]?.split("\n")).toContain(expected);
});

it("caps a why at 200 characters", () => {
  const el = render(settingsRequestPrompt("Rin", [SCREENSHOT], "a".repeat(300)));
  expect(blocks(el)[1]?.split("\n")).toContain(`“${"a".repeat(200)}”`);
});
