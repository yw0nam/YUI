// @vitest-environment jsdom
// The relation line and the reasons card, through the preset strip.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPresetRegistry,
  type PresetRegistry,
} from "../../../settings/preset/preset-registry";
import {
  createRelationsStore,
  type Relations,
  type RelationsStore,
} from "../../../settings/relations/relations-store";
import { setLocale } from "../../i18n";
import { createPresetStrip, type PresetStrip, presetStripHtml } from "./preset-strip";

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 22, 12, 0).getTime();

const OWN: Relations = {
  user: {
    value: 5,
    updated_at: NOW - HOUR,
    log: [
      { at: NOW - HOUR, delta: 2, why: "asked how my day was" },
      { at: NOW - 2 * HOUR, delta: 1, why: "laughed at the joke" },
      { at: NOW - 3 * HOUR, delta: 1, why: "fixed my window" },
      { at: NOW - 4 * HOUR, delta: 1, why: "said hello" },
    ],
    note: "trusts the work, doubts the promises",
  },
  aaaa0001: {
    value: -6,
    updated_at: NOW - 2 * HOUR,
    log: [{ at: NOW - 2 * HOUR, delta: -2, why: "took the chair" }],
  },
};

describe("preset strip — relations", () => {
  let root: HTMLElement;
  let registry: PresetRegistry;
  let store: RelationsStore;
  let strip: PresetStrip;

  function build(relations: Relations = OWN): void {
    strip?.dispose();
    store?.dispose();
    store = createRelationsStore({ storage: { load: () => relations, save: () => {} } });
    root.innerHTML = `${presetStripHtml()}<div class="yui-quick__cols"></div>`;
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    strip = createPresetStrip({ root, registry, log, relationsStore: store });
  }

  const relations = (scope: string) =>
    [...root.querySelectorAll<HTMLElement>(`${scope} .yui-relation`)].map((s) => ({
      target: s.dataset.target,
      band: s.querySelector<HTMLElement>(".yui-glyph")?.dataset.band,
      name: s.querySelector(".yui-relation__to")?.textContent,
    }));

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    localStorage.clear();
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({
        active: "default",
        list: [
          { id: "default", name: "natsume" },
          { id: "aaaa0001", name: "perlica" },
          { id: "bbbb0002", name: "shino" },
        ],
      }),
    );
    setLocale("en");
    root = document.createElement("div");
    document.body.appendChild(root);
    registry = createPresetRegistry();
    build();
  });

  afterEach(() => {
    strip.dispose();
    store.dispose();
    registry.dispose();
    root.remove();
    vi.useRealTimers();
  });

  it("lists this preset's relation toward each rated target, user first", () => {
    const line = root.querySelector<HTMLElement>(".yui-preset__rel")!;

    expect(line.hidden).toBe(false);
    expect(line.getAttribute("aria-label")).toBe("How natsume feels");
    expect(relations(".yui-preset__rel")).toEqual([
      { target: "user", band: "warm", name: "you" },
      { target: "aaaa0001", band: "cold", name: "perlica" },
    ]);
  });

  it("hides the line while no preset has a record", () => {
    build({});

    expect(root.querySelector<HTMLElement>(".yui-preset__rel")!.hidden).toBe(true);
  });

  it("adds a relation as soon as this preset rates a new target", () => {
    store.rate("bbbb0002", -2, "hummed off key", NOW);

    expect(relations(".yui-preset__rel").map((s) => s.target)).toEqual([
      "user",
      "aaaa0001",
      "bbbb0002",
    ]);
  });

  it("fills the reasons card on hover and closes it on Escape", () => {
    const relation = root.querySelector<HTMLElement>(
      '.yui-preset__rel .yui-relation[data-target="user"]',
    )!;
    const card = root.querySelector<HTMLElement>(".yui-reasons")!;

    relation.dispatchEvent(new Event("pointerover", { bubbles: true }));

    expect(card.classList.contains("is-open")).toBe(true);
    expect(relation.getAttribute("aria-describedby")).toBe(card.id);
    expect(card.querySelector(".yui-reasons__head")?.textContent).toBe("natsume: warm to you");
    expect(card.querySelector(".yui-reasons__note")?.textContent).toBe(
      "trusts the work, doubts the promises",
    );
    expect([...card.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "rose: asked how my day was1h",
      "rose: laughed at the joke2h",
      "rose: fixed my window3h",
    ]);

    relation.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(card.classList.contains("is-open")).toBe(false);
    expect(relation.hasAttribute("aria-describedby")).toBe(false);
  });
});
