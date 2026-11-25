// @vitest-environment jsdom
/** ask-queue.test.ts — one card slot shared by the push socket's Asks and Settings requests. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AskFrame } from "../../io/chat/push/push-frames";
import { setLocale } from "../../ui/i18n";
import { type AskOwner, createAskQueue } from "./ask-queue";
import { buildAskCard, SCREENSHOT } from "./ask-test-helpers";

const TITLE = "Rin wants to change settings";

const ask = (id: string, choices = [{ id: "once", label: "Allow Once" }]): AskFrame => ({
  type: "ask",
  ask: { ask_id: id, prompt: `Run ${id}?`, choices, text: false },
});

beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

it("holds a request behind a shown push Ask and starts its 60 s when it shows", async () => {
  const w = buildAskCard();
  w.push(ask("p1"));
  const result = w.request([SCREENSHOT]);
  expect(w.shown()).toEqual(["Run p1?"]);
  vi.advanceTimersByTime(90_000);
  w.choose("Allow Once");
  expect(w.shown()?.[0]).toBe(TITLE);
  vi.advanceTimersByTime(59_999);
  expect(result.value).toBeUndefined();
  vi.advanceTimersByTime(1);
  await vi.waitFor(() => expect(result.value).toBe("no answer"));
  w.dispose();
});

it("holds a push Ask behind a shown request, and its Answer then reaches the socket", async () => {
  const w = buildAskCard();
  const result = w.request([SCREENSHOT]);
  w.push(ask("p1"));
  expect(w.shown()?.[0]).toBe(TITLE);
  w.choose("Allow");
  await vi.waitFor(() => expect(result.value).toBe("allow"));
  expect(w.shown()).toEqual(["Run p1?"]);
  w.choose("Allow Once");
  expect(w.sendAnswer).toHaveBeenCalledExactlyOnceWith({
    type: "answer",
    ask_id: "p1",
    choice: "once",
  });
  expect(w.shown()).toBeNull();
  w.dispose();
});

it("shows a request with nothing picked after a push Ask answered before it, and ignores a late Answer to that Ask", async () => {
  const w = buildAskCard();
  w.push(ask("settings-request-1", [{ id: "allow", label: "Allow" }]));
  const result = w.request([SCREENSHOT]);
  w.choose("Allow");
  w.end("settings-request-1");
  expect(w.shown()?.[0]).toBe(TITLE);
  expect(w.choices().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);
  expect(w.answer({ ask_id: "settings-request-1", choice: "allow" })).toBe(false);
  await Promise.resolve();
  expect(result.value).toBeUndefined();
  w.dispose();
});

it("replaces a frame in place only within the owner that put it", () => {
  const setAsks = vi.fn();
  const asks = createAskQueue({ surfaces: { setAsks, onAskAnswer: () => {} } });
  const a: AskOwner = { answer: () => true };
  const b: AskOwner = { answer: () => true };
  asks.put(a, ask("x"));
  asks.put(b, ask("x", [{ id: "b", label: "B" }]));
  asks.put(a, ask("x", [{ id: "a2", label: "A2" }]));
  expect(setAsks).toHaveBeenLastCalledWith([
    ask("x", [{ id: "a2", label: "A2" }]),
    ask("x", [{ id: "b", label: "B" }]),
  ]);
  asks.dispose();
});

it("answers false and sends nothing for a push Ask that is not shown", () => {
  const w = buildAskCard();
  w.push(ask("p1"));
  w.push(ask("p2"));
  expect(w.answer({ ask_id: "p2", choice: "once" })).toBe(false);
  expect(w.sendAnswer).not.toHaveBeenCalled();
  expect(w.shown()).toEqual(["Run p1?"]);
  w.dispose();
});
