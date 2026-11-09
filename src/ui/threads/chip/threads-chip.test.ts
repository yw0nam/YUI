// @vitest-environment jsdom
/** threads-chip.test.ts — the Threads chip drawn from the snapshot's Threads: count, source marks, visibility, and the arrival nod. */

import { beforeEach, describe, expect, it, vi } from "vitest";

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
    entry_count: 0,
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

it("skips a waiting Thread whose open ask the user picked, and counts and nods a new ask on it", () => {
  const { chip, button } = build();
  const seen = (ask_id: string, updated_at: number): Thread => ({
    ...thread("a", "codex", updated_at),
    ask: { ask_id, prompt: "Next?", choices: [], text: true },
    seen_ask_id: "a1",
  });

  chip.update([seen("a1", 1)]);
  expect(button().hidden).toBe(true);

  chip.update([seen("a2", 2)]);
  expect(button().hidden).toBe(false);
  expect(button().querySelector(".yui-threadchip__count")!.textContent).toBe("1");
  expect(button().classList.contains("is-nod")).toBe(true);
});

it("hides while the window is open, at any count, and returns on close while something waits", () => {
  const { chip, button } = build();
  chip.update([thread("a", "codex", 5)]);

  chip.setWindowOpen(true);
  expect(button().hidden).toBe(true);

  chip.setWindowOpen(false);
  expect(button().hidden).toBe(false);
  expect(button().querySelector(".yui-threadchip__count")!.textContent).toBe("1");

  chip.setWindowOpen(true);
  chip.update([thread("a", "codex", 6, false)]);
  chip.setWindowOpen(false);
  expect(button().hidden).toBe(true);
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

  chip.setWindowOpen(true);
  chip.update([thread("c", "claude-code", 4)]);
  expect(nodding()).toBe(false);

  chip.setWindowOpen(false);
  expect(nodding()).toBe(false);
});

describe("slotRect", () => {
  const RECT = { x: 12, y: 34, width: 56, height: 32 };

  // jsdom has no layout, so the rect is a stub that records the chip's state at the moment of the read.
  function measured(folded = false) {
    const collapsed = createDelegationChipSettings();
    collapsed.setCollapsed(folded);
    const chip = createThreadsChip({ mount, collapsed, onOpen: vi.fn() });
    const button = mount.querySelector<HTMLButtonElement>(".yui-threadchip")!;
    const seen: { hidden: boolean; measuring: boolean; mini: boolean }[] = [];
    button.getBoundingClientRect = () => {
      seen.push({
        hidden: button.hidden,
        measuring: button.classList.contains("is-measuring"),
        mini: button.classList.contains("is-mini"),
      });
      return { ...RECT, top: 0, left: 0, right: 0, bottom: 0, toJSON: () => ({}) };
    };
    return { chip, button, seen };
  }

  it("returns the rect of a shown chip as it is", () => {
    const { chip, button, seen } = measured();
    chip.update([thread("a", "codex", 5)]);

    expect(chip.slotRect()).toEqual(RECT);
    expect(seen).toEqual([{ hidden: false, measuring: false, mini: false }]);
    expect(button.hidden).toBe(false);
  });

  it.each([false, true])(
    "reads a hidden chip's slot unhidden through a class and leaves it hidden, folded=%s",
    (folded) => {
      const { chip, button, seen } = measured(folded);
      chip.update([thread("w", "codex", 5, false)]);

      expect(chip.slotRect()).toEqual(RECT);
      expect(seen).toEqual([{ hidden: false, measuring: true, mini: folded }]);
      expect(button.hidden).toBe(true);
      expect(button.className).toBe(folded ? "yui-threadchip is-mini" : "yui-threadchip");
    },
  );
});
