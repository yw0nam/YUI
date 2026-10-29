// @vitest-environment jsdom
/** threads-chip.test.ts — the Threads chip drawn from the snapshot's Threads: count, source marks, visibility, and the arrival nod. */

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./threads-chip.css", () => ({}));

import type { Thread } from "../../../contract";
import { createDelegationChipSettings } from "../../../settings/panels/delegation-chip-settings";
import { setLocale } from "../../i18n";
import { createThreadsChip } from "./threads-chip";

function thread(id: string, source: string, updated_at: number, waiting = true): Thread {
  return {
    id,
    source,
    title: id,
    state: waiting ? "input-required" : "working",
    entries: [],
    created_at: 1,
    updated_at,
  };
}

let mount: HTMLElement;
beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  mount = document.createElement("div");
  document.body.appendChild(mount);
});

function build() {
  const chip = createThreadsChip({
    mount,
    collapsed: createDelegationChipSettings(),
    onOpen: vi.fn(),
  });
  const button = () => mount.querySelector<HTMLButtonElement>(".yui-threadchip")!;
  return { chip, button };
}

it("hides at zero waiting and shows the count otherwise", () => {
  const { chip, button } = build();

  chip.update([thread("w", "codex", 5, false)]);
  expect(button().hidden).toBe(true);

  chip.update([thread("a", "codex", 5)]);
  expect(button().hidden).toBe(false);
  expect(button().querySelector(".yui-threadchip__count")!.textContent).toBe("1");
});

it("marks the distinct sources of the newest waiting Threads, at most three", () => {
  const { chip, button } = build();

  chip.update([
    thread("ci", "github-ci", 10, false),
    thread("c1", "codex", 9),
    thread("cc", "claude-code", 8),
    thread("c2", "codex", 7),
    thread("s", "slack", 6),
    thread("m", "my-bot", 5),
  ]);

  const marks = [...button().querySelectorAll(".yui-threadchip__mark")];
  expect(marks.map((m) => [m.textContent, m.getAttribute("title")])).toEqual([
    ["C", "Codex"],
    ["✳", "Claude Code"],
    ["#", "Slack"],
  ]);
  expect(button().querySelector(".yui-threadchip__count")!.textContent).toBe("5");
});

it("nods only when a new Thread id starts waiting", () => {
  const { chip, button } = build();
  const nodding = () => button().classList.contains("is-nod");

  chip.update([thread("a", "codex", 1)]);
  expect(nodding()).toBe(false);

  chip.update([thread("a", "codex", 2)]);
  expect(nodding()).toBe(false);

  chip.update([thread("b", "slack", 3), thread("a", "codex", 2)]);
  expect(nodding()).toBe(true);

  button().dispatchEvent(new Event("animationend"));
  chip.update([thread("b", "slack", 3)]);
  expect(nodding()).toBe(false);
});
