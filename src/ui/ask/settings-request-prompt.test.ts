// @vitest-environment jsdom
/** settings-request-prompt.test.ts — the Settings request card's prompt as the card renders it. */

import { beforeEach, expect, it } from "vitest";
import type { SettingsChange } from "../../settings/agent-access/document";
import { setLocale } from "../i18n";
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
  [
    "privacy.screen_watch.prev_dwell_ms",
    "screen.prev_dwell_label",
    300_000,
    600_000,
    "Counts as an app switch after (5 min → 10 min)",
  ],
  [
    "privacy.screen_watch.settle_ms",
    "screen.settle_label",
    30_000,
    60_000,
    "New app settles after (30 s → 60 s)",
  ],
  [
    "privacy.screen_watch.recent_cap",
    "screen.recent_cap_label",
    20,
    30,
    "Remembers up to (20 entries → 30 entries)",
  ],
  [
    "limits.proactive_gap_ms",
    "reactions.pacer_gap_label",
    300_000,
    0,
    "Wait after a conversation (5 min → 0 min)",
  ],
  [
    "privacy.screen_source.kind",
    "screenshot.source_label",
    "window",
    "monitor",
    "Screen to send (A window → A display)",
  ],
  [
    "privacy.screen_source.index",
    "screenshot.source_label",
    0,
    1,
    "Screen to send (Display 1 → Display 2)",
  ],
])("prints %s as the settings window shows it", (path, labelKey, from, to, line) => {
  const el = render(settingsRequestPrompt("Rin", [{ path, labelKey, from, to }]));
  expect(blocks(el)[1]?.split("\n")[0]).toBe(line);
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
  ["first second", "first second"],
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
