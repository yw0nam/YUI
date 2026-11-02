// @vitest-environment jsdom
/**
 * threads-view.test.ts — the Threads window's view over a stream of snapshots: sends, errors,
 * selection, filters, the time tick, the rail, the Markdown of an entry, and the layouts the panel's width picks.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Thread, ThreadsSnapshot } from "../../../contract";
import { setLocale } from "../../i18n";
import type { TabBody, TabShell } from "./threads-tabs";
import { createThreadsView } from "./threads-view";

function thread(id: string, source: string, updated_at: number, waiting = true): Thread {
  return {
    id,
    source,
    title: id,
    state: waiting ? "input-required" : "working",
    entries: [{ role: "agent", text: "Done.", at: updated_at }],
    ...(waiting ? { ask: { ask_id: "a1", prompt: "Next?", choices: [], text: true } } : {}),
    created_at: 0,
    updated_at,
  };
}

const snapshot = (revision: number, threads: Thread[]): ThreadsSnapshot => ({ revision, threads });

/** The panel's ResizeObservers; `widen` reports a content width to each. */
let observers: { cb: ResizeObserverCallback; targets: Element[] }[] = [];
function widen(width: number): void {
  for (const o of observers) {
    const entries = o.targets.map((target) => ({ target, contentRect: { width, height: 600 } }));
    o.cb(entries as unknown as ResizeObserverEntry[], {} as ResizeObserver);
  }
}

let now = 0;
beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  now = 0;
  observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private o: { cb: ResizeObserverCallback; targets: Element[] };
      constructor(cb: ResizeObserverCallback) {
        this.o = { cb, targets: [] };
        observers.push(this.o);
      }
      observe(target: Element) {
        this.o.targets.push(target);
      }
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A stand-in Terminal tab body: its head is the test's to set, and its terminal holds xterm's field. */
function terminalTab() {
  const head = { count: "", waiting: false };
  const el = document.createElement("div");
  el.innerHTML =
    '<div class="yui-threads__panes"><nav></nav></div><div class="xterm"><textarea></textarea></div>';
  const shown = vi.fn();
  let shell: TabShell | undefined;
  const body: TabBody = {
    el,
    list: el.querySelector("nav")!,
    head: () => head,
    hasSelection: () => false,
    focusList() {},
    focusRail() {},
    move() {},
    shown,
    dispose() {},
  };
  return {
    head,
    shown,
    field: el.querySelector("textarea")!,
    redraw: () => shell!.headChanged(),
    factory: (next: TabShell) => {
      shell = next;
      return body;
    },
  };
}

function build(
  onAnswer: () => Promise<void> = () => Promise.resolve(),
  listCollapsed = false,
  listWidth: number | null = null,
) {
  const onClose = vi.fn();
  const onSeen = vi.fn();
  const onListCollapsed = vi.fn();
  const terminal = terminalTab();
  const view = createThreadsView({
    terminal: terminal.factory,
    mount: document.body,
    now: () => now,
    onAnswer,
    onSeen,
    onClose,
    listCollapsed,
    onListCollapsed,
    listWidth,
    onListWidth: vi.fn(),
    resize: { start: vi.fn(), move: vi.fn(), end: vi.fn() },
  });
  const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
  const field = () => $<HTMLTextAreaElement>(".yui-threads-answer textarea");
  const send = () => $<HTMLButtonElement>(".yui-threads-answer__send");
  const type = (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event("input"));
  };
  const enter = () =>
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
  const panel = () => $<HTMLElement>(".yui-threads__panel");
  const tab = (name: string) => $<HTMLButtonElement>(`[role="tab"][data-tab="${name}"]`);
  return {
    view,
    $,
    field,
    send,
    type,
    enter,
    onClose,
    onSeen,
    onListCollapsed,
    panel,
    terminal,
    tab,
  };
}

const key = (init: KeyboardEventInit) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
const CTRL_CMD_S = { key: "s", code: "KeyS", ctrlKey: true, metaKey: true };
const ids = (selector: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].map((el) => el.dataset.id);

it("sends once while a send is in flight, even when a snapshot rebuilds the pane", () => {
  const onAnswer = vi.fn(() => new Promise<void>(() => {}));
  const { view, send, type, enter } = build(onAnswer);
  view.update(snapshot(1, [thread("t1", "codex", 1)]));
  type("split it");
  enter();

  view.update(snapshot(2, [thread("t1", "codex", 2)]));
  enter();
  send().click();

  expect(onAnswer).toHaveBeenCalledTimes(1);
  expect(send().disabled).toBe(true);
});

const entryText = (text: string): HTMLElement => {
  const { view, $ } = build();
  view.update(
    snapshot(1, [{ ...thread("t1", "codex", 1), entries: [{ role: "agent", text, at: 1 }] }]),
  );
  return $(".yui-threads-entry__text");
};

it("renders an entry's Markdown as a table, a list, a link and an image", () => {
  const el = entryText(
    "| a | b |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n\n[docs](https://example.com/d)\n\n![shot](https://example.com/s.png)",
  );

  expect(el.querySelectorAll("table th, table td")).toHaveLength(4);
  expect(el.querySelectorAll("ul > li")).toHaveLength(2);
  expect(el.querySelector("a")?.getAttribute("target")).toBe("_blank");
  expect(el.querySelector("img")?.getAttribute("src")).toBe("https://example.com/s.png");
});

it("keeps an entry's own line breaks inside its paragraph", () => {
  const el = entryText("Changed files:\nsrc/a.ts\nsrc/b.ts");

  expect(el.querySelector("p")?.textContent).toBe("Changed files:\nsrc/a.ts\nsrc/b.ts");
  expect(readFileSync("src/ui/threads/window/thread-pane.css", "utf8")).toMatch(
    /\.yui-threads-entry__text :is\(p, li\) \{[^}]*white-space:\s*pre-wrap/,
  );
});

it("leaves no formatting whitespace between the blocks of a list or table, and keeps a tight item's newline", () => {
  const el = entryText(
    "- a\n\n- b\n\n  - n1\n  - n2\n\n  | h |\n  |---|\n  | 1 |\n\n- first\n  second",
  );

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const blanks: string[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement!.tagName.toLowerCase();
    if (
      !n.textContent!.trim() &&
      ["ul", "ol", "li", "table", "thead", "tbody", "tr"].includes(parent)
    ) {
      blanks.push(parent);
    }
  }

  expect(blanks).toEqual([]);
  expect(el.lastElementChild?.lastElementChild?.textContent).toBe("first\nsecond");
});

it("keeps only the https images", () => {
  const el = entryText(
    "![a](http://asset.localhost/x) ![b](/x) ![c](http://example.com/x.png) ![d](https://example.com/ok.png)",
  );

  expect([...el.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
    "https://example.com/ok.png",
  ]);
});

it("shows a failed send's error and keeps its draft", async () => {
  const { view, $, field, type, enter } = build(() => Promise.reject("ask is closed"));
  view.update(snapshot(1, [thread("t1", "codex", 1)]));
  type("split it");
  enter();

  await vi.waitFor(() =>
    expect($(".yui-threads-answer__error").textContent).toBe("Couldn't send: ask is closed"),
  );
  expect(field().value).toBe("split it");
});

it("keeps the selection and the filters across a newer snapshot", () => {
  const { view, $ } = build();
  view.update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1, false)]));
  $<HTMLButtonElement>('[data-tab="all"]').click();
  const kind = $<HTMLSelectElement>(".yui-threads-list__kind");
  kind.value = "slack";
  kind.dispatchEvent(new Event("change"));
  $<HTMLButtonElement>('[data-id="t2"]').click();

  view.update(
    snapshot(2, [
      thread("t3", "slack", 3),
      thread("t1", "codex", 2),
      thread("t2", "slack", 1, false),
    ]),
  );

  expect($('[data-tab="all"]').getAttribute("aria-pressed")).toBe("true");
  expect($<HTMLSelectElement>(".yui-threads-list__kind").value).toBe("slack");
  expect($('[data-id="t2"]').getAttribute("aria-current")).toBe("true");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");
});

it("redraws only the times on the minute tick, leaving the kind select in place", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { view, $ } = build();
  view.update(snapshot(1, [thread("t1", "codex", 0)]));
  const option = $<HTMLSelectElement>(".yui-threads-list__kind").options[0];

  now = 5 * 60_000;
  vi.advanceTimersByTime(60_000);

  expect($<HTMLSelectElement>(".yui-threads-list__kind").options[0]).toBe(option);
  expect($(".yui-threads-row time").textContent).toBe("5 min. ago");
  expect($(".yui-threads-entry__head time").textContent).toBe("5 min. ago");
});

it("hands a pointerdown on its head, not on its ×, to the head listeners", () => {
  const { view, $ } = build();
  const onHead = vi.fn();
  view.onHeadPointerDown(onHead);

  $(".yui-threads__close").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  $(".yui-threads__count").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  expect(onHead).toHaveBeenCalledOnce();
});

it("reports the open ask as seen only when the user picks a Thread, and not an ask already seen", async () => {
  const { view, $, onSeen } = build();
  const seen = { ...thread("t2", "slack", 1), seen_ask_id: "a1" };
  view.update(snapshot(1, [thread("t1", "codex", 2), seen]));
  await view.open(null);
  expect(onSeen).not.toHaveBeenCalled();

  $<HTMLButtonElement>('.yui-threads-list [data-id="t2"]').click();
  expect(onSeen).not.toHaveBeenCalled();

  $<HTMLButtonElement>('.yui-threads-rail [data-id="t1"]').click();
  expect(onSeen).toHaveBeenCalledExactlyOnceWith("t1", "a1");
});

it("draws the rail from the list's rows, and a rail click selects like a row", () => {
  const { view, $ } = build();
  view.update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1, false)]));

  expect(ids(".yui-threads-rail [data-id]")).toEqual(ids(".yui-threads-list [data-id]"));
  const counts = [...document.querySelectorAll(".yui-threads-rail__count")];
  expect(counts.map((el) => el.textContent)).toEqual(["1", "2"]);

  $<HTMLButtonElement>('[data-rail-tab="all"]').click();
  expect(ids(".yui-threads-rail [data-id]")).toEqual(["t1", "t2"]);
  const dots = [...document.querySelectorAll(".yui-threads-rail [data-id]")].map(
    (el) => el.querySelector(".yui-threads-rail__dot") !== null,
  );
  expect(dots).toEqual([true, false]);

  $<HTMLButtonElement>('.yui-threads-rail [data-id="t2"]').click();
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");
  expect($('.yui-threads-list [data-id="t2"]').getAttribute("aria-current")).toBe("true");
});

it.each([
  [
    "a selection",
    () => document.querySelector<HTMLElement>('.yui-threads-list [data-id="t2"]')!.click(),
  ],
  ["Escape", () => key({ key: "Escape" })],
  [
    "a pointerdown outside the list",
    () =>
      document
        .querySelector(".yui-threads-pane")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  ],
])("closes the medium layout's list overlay on %s, before the window", (_name, act) => {
  const { view, panel, onClose } = build();
  view.update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  widen(600);

  key(CTRL_CMD_S);
  expect(panel().dataset.overlay).toBe("true");
  act();

  expect(panel().dataset.overlay).toBe("false");
  expect(onClose).not.toHaveBeenCalled();
});

it("lays a stored list width under both tabs' lists, with an edge in each", () => {
  const { panel } = build(undefined, false, 312);

  expect(panel().style.getPropertyValue("--yui-threads-list-width")).toBe("312px");
  const edges = [...document.querySelectorAll(".yui-threads__panes")].map(
    (panes) => panes.querySelectorAll('[role="separator"]').length,
  );
  expect(edges).toEqual([1, 1]);
});

it("shows one pane at a time in the narrow layout: a selection opens the thread, back returns", () => {
  const { view, $, panel } = build();
  view.update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  widen(400);
  expect(panel().dataset.screen).toBe("thread");
  expect($(".yui-threads-pane__back").parentElement!.className).toBe("yui-threads-pane__line");

  $<HTMLButtonElement>(".yui-threads-pane__back").click();
  expect(panel().dataset.screen).toBe("list");

  $<HTMLButtonElement>('.yui-threads-list [data-id="t2"]').click();
  expect(panel().dataset.screen).toBe("thread");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");
});

it("keeps the stored list choice through every width without writing it", () => {
  const { panel, onListCollapsed } = build(undefined, true);

  for (const width of [800, 600, 400, 800]) widen(width);

  expect(panel().dataset.collapsed).toBe("true");
  expect(onListCollapsed).not.toHaveBeenCalled();
});

it.each([
  [
    "Control+Command+S collapses the list in the wide layout",
    800,
    CTRL_CMD_S,
    { collapsed: "true", overlay: "false" },
    [true],
  ],
  [
    "Control+Command+S opens the list overlay in the medium layout",
    600,
    CTRL_CMD_S,
    { collapsed: "false", overlay: "true" },
    [],
  ],
  [
    "Control+Command+S does nothing in the narrow layout",
    400,
    CTRL_CMD_S,
    { collapsed: "false", overlay: "false" },
    [],
  ],
  [
    "Control+S without Command leaves the wide list as it is",
    800,
    { ...CTRL_CMD_S, metaKey: false },
    { collapsed: "false", overlay: "false" },
    [],
  ],
])("%s", (_name, width, init, data, writes) => {
  const { panel, onListCollapsed } = build();
  widen(width);

  key(init);

  const { collapsed, overlay } = panel().dataset;
  expect({ collapsed, overlay }).toEqual(data);
  expect(onListCollapsed.mock.calls.map(([value]) => value)).toEqual(writes);
});

it("switches the top-level tab by a click and by the arrow keys, the count following it", () => {
  const { view, $, terminal, tab } = build();
  view.update(snapshot(1, [thread("t1", "codex", 1)]));
  terminal.head.count = "2 terminals";

  expect(tab("threads").getAttribute("aria-selected")).toBe("true");
  expect($(".yui-threads__count").textContent).toBe("1 waiting");

  tab("terminal").click();
  expect(tab("terminal").getAttribute("aria-selected")).toBe("true");
  expect(tab("threads").getAttribute("aria-selected")).toBe("false");
  expect($(".yui-threads__count").textContent).toBe("2 terminals");
  expect($<HTMLElement>(".yui-threads__panes").hidden).toBe(true);
  expect(terminal.shown).toHaveBeenCalledOnce();

  tab("terminal").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(tab("threads").getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(tab("threads"));
  expect($<HTMLElement>(".yui-threads__panes").hidden).toBe(false);
});

it("dots only the unselected tab where something waits for the user", () => {
  const { view, terminal, tab } = build();
  view.update(snapshot(1, [thread("t1", "codex", 1)]));
  terminal.head.waiting = true;
  terminal.redraw();
  const dotted = () =>
    ["threads", "terminal"].filter((name) => tab(name).querySelector(".yui-threads__tab-dot"));

  expect(dotted()).toEqual(["terminal"]);
  tab("terminal").click();
  expect(dotted()).toEqual(["threads"]);
});

it.each([
  ["Escape", { key: "Escape" }],
  ["Control+Command+S", CTRL_CMD_S],
])("leaves %s typed in the terminal to the shell", (_name, init) => {
  const { onClose, onListCollapsed, terminal, tab } = build();
  widen(800);
  tab("terminal").click();

  terminal.field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));

  expect(onClose).not.toHaveBeenCalled();
  expect(onListCollapsed).not.toHaveBeenCalled();
});

it("opens on the asked tab without the grow when the open has no origin", async () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  HTMLElement.prototype.animate = animate as never;
  const { view, $, tab } = build();

  await view.open(null, "terminal");

  expect($(".yui-threads").classList.contains("is-open")).toBe(true);
  expect(tab("terminal").getAttribute("aria-selected")).toBe("true");
  expect(animate).not.toHaveBeenCalled();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});
