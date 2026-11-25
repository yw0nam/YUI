// @vitest-environment jsdom
/**
 * threads-view.test.tsx — the Threads window's view over a stream of snapshots: the read-only pane,
 * selection, filters, the time tick, the rail, the Markdown of an entry, and the layouts the panel's width picks.
 */

import { readFileSync } from "node:fs";
import { act, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AttachedThread, Thread, ThreadsSnapshot } from "../../../contract";
import { setLocale } from "../../i18n";
import type { TabBody, TabShell } from "./tab-body";
import { createThreadsView, type ThreadsView } from "./threads-view";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function thread(id: string, source: string, updated_at: number, waiting = true): Thread {
  return {
    id,
    source,
    title: id,
    state: waiting ? "input-required" : "working",
    entries: [{ role: "agent", text: "Done.", at: updated_at }],
    created_at: 0,
    updated_at,
    entry_count: 0,
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
let views: ThreadsView[] = [];
afterEach(() => {
  act(() => {
    for (const view of views) view.dispose();
  });
  views = [];
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

function build(listCollapsed = false, listWidth: number | null = null) {
  const onClose = vi.fn();
  const onRead = vi.fn();
  const onListCollapsed = vi.fn();
  const onAttach = vi.fn();
  const terminal = terminalTab();
  let attachedNow: AttachedThread[] = [];
  const attachedSubs = new Set<() => void>();
  const view = createThreadsView({
    terminal: terminal.factory,
    mount: document.body,
    now: () => now,
    onRead,
    onClose,
    listCollapsed,
    onListCollapsed,
    listWidth,
    onListWidth: vi.fn(),
    resize: { start: vi.fn(), move: vi.fn(), end: vi.fn() },
    onTurnsLevel: vi.fn(),
    attached: {
      get: () => attachedNow,
      subscribe: (cb) => {
        attachedSubs.add(cb);
        return () => attachedSubs.delete(cb);
      },
    },
    onAttach,
  });
  views.push(view);
  const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
  const panel = () => $<HTMLElement>(".yui-threads__panel");
  const tab = (name: string) => document.getElementById(`yui-tab-${name}`)!;
  return {
    view,
    update: (next: ThreadsSnapshot) => act(() => view.update(next)),
    open: (...args: Parameters<ThreadsView["open"]>) => act(() => view.open(...args)),
    $,
    onClose,
    onRead,
    onListCollapsed,
    onAttach,
    attach: (threads: AttachedThread[]) =>
      act(() => {
        attachedNow = threads;
        for (const cb of attachedSubs) cb();
      }),
    panel,
    terminal,
    tab,
  };
}

const key = (init: KeyboardEventInit) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  });
const click = (el: Element) => fireEvent.click(el);
/** The list's or the rail's Waiting / All radio whose name starts with `name`. */
const filter = (nav: "list" | "rail", name: RegExp) =>
  within(document.querySelector<HTMLElement>(`.yui-threads-${nav}`)!).getByRole("radio", { name });
/** Opens the list's kind select and picks the item labelled `label`, as a pointer does. */
async function pickKind(label: string) {
  await act(async () => {
    fireEvent.click(document.querySelector(".yui-threads-list__kind")!);
  });
  const item = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (o) => o.textContent === label && !o.closest("[hidden]"),
  )!;
  await act(async () => {
    fireEvent.pointerDown(item);
    fireEvent.click(item);
  });
}
const CTRL_CMD_S = { key: "s", code: "KeyS", ctrlKey: true, metaKey: true };
const ids = (selector: string) =>
  [...document.querySelectorAll<HTMLElement>(selector)].map((el) => el.dataset.id);

it("closes the Thread turns menu on Escape, before the window", () => {
  const { $, onClose } = build();
  click($(".yui-threads__turns-button"));

  expect($(".yui-threads__turns-button").getAttribute("aria-expanded")).toBe("true");

  key({ key: "Escape" });

  expect($(".yui-threads__turns-button").getAttribute("aria-expanded")).toBe("false");
  expect(onClose).not.toHaveBeenCalled();
});

it("keeps the arrows from the list while the Thread turns menu is open", () => {
  const { update, $ } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "codex", 1)]));
  click($(".yui-threads__turns-button"));

  key({ key: "ArrowDown" });

  expect($(".yui-threads-pane__head h2").textContent).toBe("t1");
});

const entryText = (text: string): HTMLElement => {
  const { update, $ } = build();
  update(snapshot(1, [{ ...thread("t1", "codex", 1), entries: [{ role: "agent", text, at: 1 }] }]));
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

it("leaves ↑ and ↓ on a focused Waiting / All radio to the filter, not to the rows", async () => {
  const { update, $ } = build();
  update(
    snapshot(1, [
      thread("t1", "codex", 3),
      thread("t2", "codex", 2),
      thread("t3", "codex", 1, false),
    ]),
  );
  const waiting = filter("list", /^Waiting/);
  act(() => waiting.focus());

  await act(async () => {
    fireEvent.keyDown(waiting, { key: "ArrowDown" });
  });

  expect(filter("list", /^All/).getAttribute("aria-checked")).toBe("true");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t1");
});

it("keeps the medium layout's list overlay open through a pointer pick in the kind popup, and applies the kind", async () => {
  const { update, $, panel } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  widen(600);
  key(CTRL_CMD_S);

  await pickKind("Slack (1)");

  expect(panel().dataset.overlay).toBe("true");
  expect($(".yui-threads-list__kind").textContent).toBe("Slack (1)");
  expect(ids(".yui-threads-list [data-id]")).toEqual(["t2"]);
});

it("keeps the selection and the filters across a newer snapshot", async () => {
  const { update, $ } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1, false)]));
  click(filter("list", /^All/));
  await pickKind("Slack (1)");
  click($('.yui-threads-list [data-id="t2"]'));

  update(
    snapshot(2, [
      thread("t3", "slack", 3),
      thread("t1", "codex", 2),
      thread("t2", "slack", 1, false),
    ]),
  );

  expect(filter("list", /^All/).getAttribute("aria-checked")).toBe("true");
  expect($(".yui-threads-list__kind").textContent).toBe("Slack (2)");
  expect($('.yui-threads-list [data-id="t2"]').getAttribute("aria-current")).toBe("true");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");
});

it("redraws only the times on the minute tick, leaving the kind select in place", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const { update, $ } = build();
  update(snapshot(1, [thread("t1", "codex", 0)]));
  const kind = $(".yui-threads-list__kind");

  now = 5 * 60_000;
  act(() => vi.advanceTimersByTime(60_000));

  expect($(".yui-threads-list__kind")).toBe(kind);
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

it("an automatic open selects the asked Thread on the filter that holds it and moves no focus", async () => {
  const { update, open, $ } = build();
  update(
    snapshot(1, [
      thread("t1", "codex", 3),
      thread("t2", "codex", 2, false),
      thread("t3", "codex", 1),
    ]),
  );

  await open(null, "threads", { thread: "t2", focus: false });
  expect(filter("list", /^All/).getAttribute("aria-checked")).toBe("true");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");

  await open(null, "threads", { thread: "t3", focus: false });
  expect(filter("list", /^Waiting/).getAttribute("aria-checked")).toBe("true");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t3");
  expect(document.activeElement).toBe(document.body);
});

it("selects an asked Thread on the first snapshot that holds it, until a user pick or the next open", async () => {
  const { update, open, $ } = build();
  await open(null, "threads", { thread: "t2", focus: false });
  update(snapshot(1, [thread("t1", "codex", 3)]));
  update(snapshot(2, [thread("t1", "codex", 3), thread("t2", "codex", 2, false)]));
  expect(filter("list", /^All/).getAttribute("aria-checked")).toBe("true");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");

  await open(null, "threads", { thread: "t9", focus: false });
  click($('.yui-threads-list [data-id="t1"]'));
  update(snapshot(3, [thread("t1", "codex", 3), thread("t9", "codex", 4, false)]));
  expect($(".yui-threads-pane__head h2").textContent).toBe("t1");

  await open(null, "threads", { thread: "t8", focus: false });
  await open(null);
  update(snapshot(4, [thread("t1", "codex", 3), thread("t8", "codex", 5, false)]));
  expect($(".yui-threads-pane__head h2").textContent).toBe("t1");
});

it("shows an input-required Thread read-only: its entries and Mark read, and no answer area or field", () => {
  const { update, $ } = build();
  update(snapshot(1, [thread("t1", "codex", 1)]));

  expect($(".yui-threads-entry__text").textContent).toBe("Done.");
  expect($(".yui-threads-pane__read").textContent).toBe("Mark read");
  expect(
    document.querySelectorAll(".yui-threads-pane .yui-answer, .yui-threads-pane textarea"),
  ).toHaveLength(0);
});

it("the pane's Attach to chat button shows whether its Thread is attached and asks to toggle it", () => {
  const { update, onAttach, attach } = build();
  update(snapshot(1, [thread("A", "codex", 2), thread("B", "gmail", 1)]));
  const button = () => document.querySelector<HTMLButtonElement>(".yui-threads-pane__attach");

  expect(button()?.textContent).toBe("Attach to chat");
  click(button()!);
  expect(onAttach).toHaveBeenCalledExactlyOnceWith({ id: "A", source: "codex", title: "A" });

  attach([{ id: "A", source: "codex", title: "A" }]);
  expect(button()?.textContent).toBe("Attached");

  click(document.querySelector('.yui-threads-list [data-id="B"]')!);
  expect(button()?.textContent).toBe("Attach to chat");
});

it("Mark read asks the store, and the selection moves on once a snapshot shows the Thread read", () => {
  const { update, $, onRead } = build();
  const [a, b, c] = [thread("A", "codex", 3), thread("B", "codex", 2), thread("C", "codex", 1)];
  update(snapshot(1, [a, b, c]));
  expect($(".yui-threads-pane__head h2").textContent).toBe("A");

  click($(".yui-threads-pane__read"));
  expect(onRead).toHaveBeenCalledExactlyOnceWith("A");
  expect($(".yui-threads-pane__head h2").textContent).toBe("A");

  update(snapshot(2, [{ ...a, read: true }, b, c]));
  expect($(".yui-threads-pane__head h2").textContent).toBe("B");
  expect(ids(".yui-threads-list [data-id]")).toEqual(["B", "C"]);
  expect($(".yui-threads__count").textContent).toBe("2 waiting");

  click(filter("list", /^All/));
  click($('.yui-threads-list [data-id="A"]'));
  expect($(".yui-threads-pane__head h2").textContent).toBe("A");
  expect(document.querySelector(".yui-threads-pane__read")).toBeNull();
});

it("moves to a waiting Thread even when the snapshot also shows the next one read", () => {
  const { update, $ } = build();
  const [a, b, c] = [thread("A", "codex", 3), thread("B", "codex", 2), thread("C", "codex", 1)];
  update(snapshot(1, [a, b, c]));

  update(snapshot(2, [{ ...a, read: true }, { ...b, read: true }, c]));

  expect($(".yui-threads-pane__head h2").textContent).toBe("C");
});

it("draws the rail from the list's rows, and a rail click selects like a row", () => {
  const { update, $ } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1, false)]));

  expect(ids(".yui-threads-rail [data-id]")).toEqual(ids(".yui-threads-list [data-id]"));
  const counts = [...document.querySelectorAll(".yui-threads-rail__count")];
  expect(counts.map((el) => el.textContent)).toEqual(["1", "2"]);

  click(filter("rail", /in all$/));
  expect(ids(".yui-threads-rail [data-id]")).toEqual(["t1", "t2"]);
  const dots = [...document.querySelectorAll(".yui-threads-rail [data-id]")].map(
    (el) => el.querySelector(".yui-threads-rail__dot") !== null,
  );
  expect(dots).toEqual([true, false]);

  click($('.yui-threads-rail [data-id="t2"]'));
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");
  expect($('.yui-threads-list [data-id="t2"]').getAttribute("aria-current")).toBe("true");
});

it.each([
  ["a selection", () => click(document.querySelector('.yui-threads-list [data-id="t2"]')!)],
  ["Escape", () => key({ key: "Escape" })],
  [
    "a pointerdown outside the list",
    () =>
      document
        .querySelector(".yui-threads-pane")!
        .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
  ],
])("closes the medium layout's list overlay on %s, before the window", (_name, act) => {
  const { update, panel, onClose } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  widen(600);

  key(CTRL_CMD_S);
  expect(panel().dataset.overlay).toBe("true");
  act();

  expect(panel().dataset.overlay).toBe("false");
  expect(onClose).not.toHaveBeenCalled();
});

it("lays a stored list width under both tabs' lists, with an edge in each", () => {
  const { panel } = build(false, 312);

  expect(panel().style.getPropertyValue("--yui-threads-list-width")).toBe("312px");
  const edges = [...document.querySelectorAll(".yui-threads__panes")].map(
    (panes) => panes.querySelectorAll('[role="separator"]').length,
  );
  expect(edges).toEqual([1, 1]);
});

it("keeps each list's edge right after the list through a newer snapshot", () => {
  const { update } = build();
  update(snapshot(1, [thread("t1", "codex", 2)]));

  update(snapshot(2, [thread("t2", "slack", 3), thread("t1", "codex", 2, false)]));

  const list = document.getElementById("yui-threads-list")!;
  expect(list.nextElementSibling?.getAttribute("role")).toBe("separator");
});

it("shows one pane at a time in the narrow layout: a selection opens the thread, back returns", () => {
  const { update, $, panel } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  widen(400);
  expect(panel().dataset.screen).toBe("thread");
  expect($(".yui-threads-pane__back").parentElement!.className).toBe("yui-threads-pane__line");

  click($(".yui-threads-pane__back"));
  expect(panel().dataset.screen).toBe("list");

  click($('.yui-threads-list [data-id="t2"]'));
  expect(panel().dataset.screen).toBe("thread");
  expect($(".yui-threads-pane__head h2").textContent).toBe("t2");
});

it("keeps the stored list choice through every width without writing it", () => {
  const { panel, onListCollapsed } = build(true);

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

it("switches the top-level tab by a click, by the arrow keys wrapping at either end, and by End, the count following it", async () => {
  const { update, $, terminal } = build();
  update(snapshot(1, [thread("t1", "codex", 1)]));
  terminal.head.count = "2 terminals";
  const tab = (id: string) => document.getElementById(`yui-tab-${id}`)!;
  const selected = () => document.querySelector('[role="tab"][aria-selected="true"]')?.id;
  const press = async (key: string) => {
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key });
    });
  };

  expect(selected()).toBe("yui-tab-threads");
  expect($(".yui-threads__count").textContent).toBe("1 waiting");

  fireEvent.click(tab("terminal"));
  expect(selected()).toBe("yui-tab-terminal");
  expect($(".yui-threads__count").textContent).toBe("2 terminals");
  expect(document.getElementById("yui-panel-threads")!.hidden).toBe(true);
  expect(terminal.shown).toHaveBeenCalledOnce();

  act(() => tab("terminal").focus());
  await press("ArrowRight");
  expect(selected()).toBe("yui-tab-threads");
  expect(document.activeElement).toBe(tab("threads"));
  expect(document.getElementById("yui-panel-threads")!.hidden).toBe(false);

  await press("End");
  expect(selected()).toBe("yui-tab-terminal");
  await press("ArrowLeft");
  expect(selected()).toBe("yui-tab-threads");
  await press("ArrowLeft");
  expect(selected()).toBe("yui-tab-terminal");
});

it("dots only the unselected tab where something waits for the user", () => {
  const { update, terminal, tab } = build();
  update(snapshot(1, [thread("t1", "codex", 1)]));
  terminal.head.waiting = true;
  act(() => terminal.redraw());
  const dotted = () =>
    ["threads", "terminal"].filter((name) => tab(name).querySelector(".yui-threads__tab-dot"));

  expect(dotted()).toEqual(["terminal"]);
  click(tab("terminal"));
  expect(dotted()).toEqual(["threads"]);
});

it.each([
  ["Escape", { key: "Escape" }],
  ["Control+Command+S", CTRL_CMD_S],
])("leaves %s typed in the terminal to the shell", (_name, init) => {
  const { onClose, onListCollapsed, terminal, tab } = build();
  widen(800);
  click(tab("terminal"));

  terminal.field.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));

  expect(onClose).not.toHaveBeenCalled();
  expect(onListCollapsed).not.toHaveBeenCalled();
});

it("opens on the asked tab without the grow when the open has no origin", async () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  HTMLElement.prototype.animate = animate as never;
  const { open, $, tab } = build();

  await open(null, "terminal");

  expect($(".yui-threads").classList.contains("is-open")).toBe(true);
  expect(tab("terminal").getAttribute("aria-selected")).toBe("true");
  expect(animate).not.toHaveBeenCalled();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
});

/** Whether any animation an open out of the chip runs carries a scale. */
async function opensWithScale(opts?: { focus: false }): Promise<boolean> {
  const animate = vi.fn((_frames: Keyframe[]) => ({
    finished: Promise.resolve(),
  }));
  HTMLElement.prototype.animate = animate as never;
  const { open } = build();
  await open({ x: 700, y: 640, width: 150, height: 32 }, "threads", opts);
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  return animate.mock.calls.some(([frames]) =>
    frames.some((frame) => String(frame.transform ?? "").includes("scale(")),
  );
}

it.each([
  ["an automatic open", { focus: false }, "with", true],
  ["a user's open", undefined, "without", false],
] as const)("%s grows %s the jelly", async (_name, opts, _with, jelly) => {
  expect(await opensWithScale(opts)).toBe(jelly);
});

const entries = (n: number, from = 1): Thread["entries"] =>
  Array.from({ length: n }, (_, i) => {
    const at = from + i;
    return { role: "agent", text: `entry ${at}`, at };
  });

/** Lays out entries and their wrapper inside `run`, since jsdom has no layout. */
function withEntryHeights(run: () => void): void {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
    if (this.classList.contains("yui-threads-entry"))
      return { bottom: 100 * ([...this.parentElement!.children].indexOf(this) + 1) } as DOMRect;
    if (this.classList.contains("yui-threads-pane__entries"))
      return { bottom: 100 * this.childElementCount } as DOMRect;
    return original.call(this);
  };
  try {
    run();
  } finally {
    Element.prototype.getBoundingClientRect = original;
  }
}

it("holds the pane's redraw while the Terminal tab shows, and keeps the reader on return", () => {
  const { update, $, tab } = build();
  update(snapshot(1, [{ ...thread("t1", "codex", 1), entries: entries(3) }]));
  withEntryHeights(() => {
    $(".yui-threads-pane__transcript").scrollTop = -50;
    click(tab("terminal"));
    update(snapshot(2, [{ ...thread("t1", "codex", 2), entries: entries(4) }]));

    expect(document.querySelector(".yui-threads-pane__entries")!.childElementCount).toBe(3);

    click(tab("threads"));
    expect(document.querySelector(".yui-threads-pane__entries")!.childElementCount).toBe(4);
    expect($(".yui-threads-pane__transcript").scrollTop).toBe(-150);
  });
});

it("keeps a reader above the newest entry in place, and a reader at the newest entry there", () => {
  const { update, $ } = build();
  update(snapshot(1, [{ ...thread("t1", "codex", 1), entries: entries(3) }]));
  withEntryHeights(() => {
    $(".yui-threads-pane__transcript").scrollTop = -50;
    update(snapshot(2, [{ ...thread("t1", "codex", 2), entries: entries(4) }]));
    expect($(".yui-threads-pane__transcript").scrollTop).toBe(-150);

    $(".yui-threads-pane__transcript").scrollTop = 0;
    update(snapshot(3, [{ ...thread("t1", "codex", 3), entries: entries(5) }]));
    expect($(".yui-threads-pane__transcript").scrollTop).toBe(0);

    update(snapshot(4, [{ ...thread("t1", "codex", 4), entries: entries(4, 1) }]));
    $(".yui-threads-pane__transcript").scrollTop = -50;
    update(snapshot(5, [{ ...thread("t1", "codex", 5), entries: entries(4, 2) }]));
    expect($(".yui-threads-pane__transcript").scrollTop).toBe(-150);
  });
});

it("starts a picked Thread and a fresh open at the newest entry", async () => {
  const { update, open, $ } = build();
  update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  $(".yui-threads-pane__transcript").scrollTop = -50;

  click($('.yui-threads-list [data-id="t2"]'));
  expect($(".yui-threads-pane__transcript").scrollTop).toBe(0);

  click($('.yui-threads-list [data-id="t1"]'));
  $(".yui-threads-pane__transcript").scrollTop = -50;
  await open(null);
  expect($(".yui-threads-pane__transcript").scrollTop).toBe(0);
});

it("anchors the transcript at its newest entry with a column-reverse scroll", () => {
  expect(readFileSync("src/ui/threads/window/thread-pane.css", "utf8")).toMatch(
    /\.yui-threads-pane__transcript \{[^}]*flex-direction:\s*column-reverse/,
  );
});
