// @vitest-environment jsdom
/**
 * threads-view.test.ts — the Threads window's view over a stream of snapshots: sends, errors,
 * selection, filters, the time tick, the rail, and the layouts the panel's width picks.
 */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Thread, ThreadsSnapshot } from "../../../contract";
import { setLocale } from "../../i18n";
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

function build(onAnswer: () => Promise<void> = () => Promise.resolve(), listCollapsed = false) {
  const onClose = vi.fn();
  const onListCollapsed = vi.fn();
  const view = createThreadsView({
    mount: document.body,
    now: () => now,
    onAnswer,
    onClose,
    listCollapsed,
    onListCollapsed,
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
  return { view, $, field, send, type, enter, onClose, onListCollapsed, panel };
}

const key = (init: KeyboardEventInit) =>
  document.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, ...init }));
const toggleKey = () => key({ key: "s", code: "KeyS", ctrlKey: true, metaKey: true });
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
  $(".yui-threads__head h1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  expect(onHead).toHaveBeenCalledOnce();
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

  toggleKey();
  expect(panel().dataset.overlay).toBe("true");
  act();

  expect(panel().dataset.overlay).toBe("false");
  expect(onClose).not.toHaveBeenCalled();
});

it("shows one pane at a time in the narrow layout: a selection opens the thread, back returns", () => {
  const { view, $, panel } = build();
  view.update(snapshot(1, [thread("t1", "codex", 2), thread("t2", "slack", 1)]));
  widen(400);
  expect(panel().dataset.screen).toBe("thread");

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
  ["collapses the list in the wide layout", 800, { collapsed: "true", overlay: "false" }, [true]],
  ["opens the list overlay in the medium layout", 600, { collapsed: "false", overlay: "true" }, []],
  ["does nothing in the narrow layout", 400, { collapsed: "false", overlay: "false" }, []],
])("Control+Command+S %s", (_name, width, data, writes) => {
  const { panel, onListCollapsed } = build();
  widen(width);

  toggleKey();

  const { collapsed, overlay } = panel().dataset;
  expect({ collapsed, overlay }).toEqual(data);
  expect(onListCollapsed.mock.calls.map(([value]) => value)).toEqual(writes);
});
