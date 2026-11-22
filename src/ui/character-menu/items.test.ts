import { beforeEach, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { listItems, type MenuState, topItems } from "./items";

beforeEach(() => setLocale("en"));

const state = (over: Partial<MenuState> = {}): MenuState => ({
  talk: false,
  rest: false,
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

it("marks each top-level toggle with its state and names Rest by its glossary term", () => {
  const top = topItems("main", state({ talk: true, rest: true, listen: false }));

  expect(top.right.map((i) => [i.label, i.on])).toEqual([
    ["Talk", true],
    ["Rest", true],
    ["Listen", false],
    ["Settings", undefined],
  ]);
  expect(top.right[1]!.aria).toBe("Do-not-disturb");
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
