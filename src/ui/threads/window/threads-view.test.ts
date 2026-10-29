// @vitest-environment jsdom
/** threads-view.test.ts — the Threads window's view over a stream of snapshots: sends, errors, selection, filters, and the time tick. */

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

let now = 0;
beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  now = 0;
});
afterEach(() => vi.useRealTimers());

function build(onAnswer: () => Promise<void> = () => Promise.resolve()) {
  const view = createThreadsView({
    mount: document.body,
    now: () => now,
    onAnswer,
    onClose: vi.fn(),
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
  return { view, $, field, send, type, enter };
}

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
