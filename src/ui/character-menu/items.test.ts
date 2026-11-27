import { beforeEach, expect, it } from "vitest";
import type { MenuState } from "../../io/bridge/settings-bridge";
import type { RestState } from "../../settings/rest/rest-choices";
import { setLocale } from "../i18n";
import { listItems, topItems } from "./items";

beforeEach(() => setLocale("en"));

const state = (over: Partial<MenuState> = {}): MenuState => ({
  talk: false,
  rest: null,
  listen: false,
  bubble: false,
  unified: false,
  bodies: [
    { id: "yui", label: "Yui" },
    { id: "natsume", label: "Natsume" },
  ],
  body: "natsume",
  voices: [
    { id: "", label: "" },
    { id: "v1", label: "Soft" },
  ],
  voice: "",
  pace: "normal",
  waiting: 2,
  ...over,
});

const ids = (items: { id: string }[]) => items.map((i) => i.id);

it.each([
  ["main", ["talk", "rest", "listen", "settings"]],
  ["bound", ["talk", "rest", "settings"]],
] as const)("the %s window's right column holds %j", (kind, right) => {
  const top = topItems(kind, state());

  expect(ids(top.right)).toEqual(right);
  expect(ids(top.left)).toEqual(["body", "voice", "pace", "more"]);
});

it("marks each top-level toggle with its state", () => {
  const top = topItems("main", state({ talk: true, listen: false }));

  expect(top.right.map((i) => [i.label, i.on])).toEqual([
    ["Talk", true],
    ["Rest", false],
    ["Listen", false],
    ["Settings", undefined],
  ]);
});

const clock = (h: number, m: number, day = 26) => new Date(2026, 10, day, h, m).getTime();

it.each([
  ["off", null, clock(21, 10), ["Rest", false, false]],
  [
    "resting until morning",
    { kind: "rest", choice: "morning", startedAt: clock(21, 10), endsAt: clock(8, 0, 27) },
    clock(21, 10),
    ["Rest · 08:00", true, false],
  ],
  [
    "seven minutes into Focus 50",
    { kind: "focus", choice: "focus_50", startedAt: clock(14, 0), endsAt: clock(14, 50) },
    clock(14, 7),
    ["Focus · 43 min", true, false],
  ],
  [
    "resting until the user turns it off",
    { kind: "rest", choice: "until_off", startedAt: clock(21, 10) },
    clock(21, 12),
    ["Rest", true, true],
  ],
  [
    "in a quiet span",
    { kind: "quiet", endsAt: clock(12, 0) },
    clock(10, 20),
    ["Quiet · 12:00", false, false],
  ],
  ["in an all-day quiet span", { kind: "quiet" }, clock(10, 20), ["Quiet", false, false]],
] as const)("labels Rest %s and opens its list", (_name, rest, now, [label, on, onText]) => {
  const item = topItems("main", state({ rest: rest as RestState | null }), now).right[1]!;

  expect([item.role, item.label, item.on === true, item.onText === true]).toEqual([
    "list",
    label,
    on,
    onText,
  ]);
});

const OFF_ROWS = [
  ["back", "Back"],
  ["action", "For 1 hour"],
  ["action", "Until tonight"],
  ["action", "Until tomorrow morning"],
  ["action", "Until I turn it off"],
  ["divider", ""],
  ["action", "Focus 25 min"],
  ["action", "Focus 50 min"],
];

it.each([
  ["off at 21:10", null, clock(21, 10), OFF_ROWS],
  ["off at 00:30", null, clock(0, 30), OFF_ROWS.filter(([, label]) => label !== "Until tonight")],
  ["in a quiet span", { kind: "quiet", endsAt: clock(12, 0) }, clock(10, 20), OFF_ROWS],
  [
    "resting until morning",
    { kind: "rest", choice: "morning", startedAt: clock(21, 10), endsAt: clock(8, 0, 27) },
    clock(21, 10),
    [
      ["back", "Back"],
      ["status", "Resting until 08:00"],
      ["action", "End now"],
      ["action", "For 1 hour"],
      ["action", "Until tonight"],
      ["action", "Until I turn it off"],
      ["divider", ""],
      ["action", "Focus 25 min"],
      ["action", "Focus 50 min"],
    ],
  ],
  [
    "in Focus 25",
    { kind: "focus", choice: "focus_25", startedAt: clock(21, 10), endsAt: clock(21, 35) },
    clock(21, 17),
    [
      ["back", "Back"],
      ["status", "Focus · 18 min left"],
      ["action", "End now"],
      ["action", "For 1 hour"],
      ["action", "Until tonight"],
      ["action", "Until tomorrow morning"],
      ["action", "Until I turn it off"],
      ["divider", ""],
      ["action", "Focus 50 min"],
    ],
  ],
  [
    "resting until the user turns it off",
    { kind: "rest", choice: "until_off", startedAt: clock(21, 10) },
    clock(21, 12),
    [
      ["back", "Back"],
      ["status", "Resting"],
      ["action", "End now"],
      ["action", "For 1 hour"],
      ["action", "Until tonight"],
      ["action", "Until tomorrow morning"],
      ["divider", ""],
      ["action", "Focus 25 min"],
      ["action", "Focus 50 min"],
    ],
  ],
] as const)("the Rest list %s holds its rows", (_name, rest, now, rows) => {
  const items = listItems("rest", "main", state({ rest: rest as RestState | null }), now);

  expect(items.map((i) => [i.role, i.label])).toEqual(rows);
});

it.each([
  ["main", ["back", "threads", "bubble", "unified", "terminal", "reset"], 2],
  ["bound", ["back", "threads", "bubble", "unified", "terminal", "reset", "turn-off"], undefined],
] as const)("the %s window's More list holds %j", (kind, more, badge) => {
  const items = listItems("more", kind, state({ bubble: true }));

  expect(ids(items)).toEqual(more);
  expect(items.find((i) => i.id === "threads")!.badge).toBe(badge);
  expect(items.find((i) => i.id === "bubble")!.on).toBe(true);
  expect(items.filter((i) => i.role === "danger").map((i) => i.id)).toEqual(
    more.filter((id) => id === "reset" || id === "turn-off"),
  );
});

it.each([
  ["body", ["back", "body:yui", "body:natsume", "body-more"], "body:natsume", ["Yui", "Natsume"]],
  ["voice", ["back", "voice:", "voice:v1", "voice-more"], "voice:", ["None", "Soft"]],
  [
    "pace",
    ["back", "pace:low", "pace:normal", "pace:high"],
    "pace:normal",
    ["Less", "Normal", "More"],
  ],
] as const)("the %s list holds %j and marks the current choice", (list, all, current, labels) => {
  const items = listItems(list, "main", state());

  expect(ids(items)).toEqual(all);
  expect(items.filter((i) => i.on).map((i) => i.id)).toEqual([current]);
  expect(items.filter((i) => i.role === "choice").map((i) => i.label)).toEqual(labels);
});

const options = Array.from({ length: 30 }, (_, i) => ({ id: `o${i + 1}`, label: `O${i + 1}` }));

it.each([
  ["body", "o30", "bodies", ["o1", "o2", "o3", "o4", "o30"]],
  ["body", "o3", "bodies", ["o1", "o2", "o3", "o4", "o5"]],
  ["voice", "o30", "voices", ["o1", "o2", "o3", "o4", "o30"]],
] as const)("the %s list of 30 shows five with the current %s among them, then More…", (list, current, key, shown) => {
  const items = listItems(list, "main", state({ [key]: options, [list]: current }));

  expect(ids(items)).toEqual(["back", ...shown.map((id) => `${list}:${id}`), `${list}-more`]);
});

it("names the Settings, Back and More… pills by what they do", () => {
  const aria = (items: { id: string; aria?: string }[], id: string) =>
    items.find((i) => i.id === id)?.aria;

  expect(aria(topItems("main", state()).right, "settings")).toBe(
    "Settings, opens the settings window",
  );
  expect(aria(listItems("body", "main", state()), "back")).toBe("Back to the menu");
  expect(aria(listItems("body", "main", state()), "body-more")).toBe("More bodies, opens Settings");
  expect(aria(listItems("voice", "main", state()), "voice-more")).toBe(
    "More voices, opens Settings",
  );
});
