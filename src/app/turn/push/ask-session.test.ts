// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AskAnswer, AskFrame } from "../../../io/chat/push/push-frames";
import type { PushSocket } from "../../../io/chat/push/push-socket";
import { createAskCard } from "../../../ui/ask/ask-card";
import { setLocale } from "../../../ui/i18n";
import { wireAskSession } from "./ask-session";

const frame = (id: string, expires_at?: number): AskFrame => ({
  type: "ask",
  ask: { ask_id: id, prompt: `Run ${id}?`, choices: [], text: true },
  ...(expires_at === undefined ? {} : { expires_at }),
});

function build(card = false) {
  let ask!: Parameters<PushSocket["onAsk"]>[0];
  let end!: Parameters<PushSocket["onAskEnd"]>[0];
  let state!: Parameters<PushSocket["onState"]>[0];
  let answer!: (answer: AskAnswer) => boolean;
  const sendAnswer = vi.fn(() => true);
  const off = vi.fn();
  const mount = document.createElement("div");
  document.body.append(mount);
  const view = card ? createAskCard({ mount }) : undefined;
  view?.onAnswer((a) => answer(a));
  const setAsks = vi.fn((frames: AskFrame[]) => view?.set(frames));
  const dispose = wireAskSession({
    socket: {
      onAsk: (cb) => {
        ask = cb;
        return off;
      },
      onAskEnd: (cb) => {
        end = cb;
        return off;
      },
      onState: (cb) => {
        state = cb;
        return off;
      },
      sendAnswer,
    },
    surfaces: {
      setAsks,
      onAskAnswer: (cb) => {
        answer = cb;
      },
    },
  });
  return {
    ask: (f: AskFrame) => ask(f),
    end: (id: string) => end(id),
    state: () => state({ kind: "disconnected" }),
    answer: (a: AskAnswer) => answer(a),
    sendAnswer,
    setAsks,
    mount,
    off,
    dispose: () => {
      dispose();
      view?.dispose();
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers({ now: 0 });
  setLocale("en");
  document.body.innerHTML = "";
});
afterEach(() => vi.useRealTimers());

it("holds arrival order, replaces in place and removes an ended Ask", () => {
  const w = build();
  w.ask(frame("a"));
  w.ask(frame("b"));
  w.ask({ type: "ask", ask: { ask_id: "a", prompt: "Again?", choices: [], text: false } });
  expect(w.setAsks).toHaveBeenLastCalledWith([
    { type: "ask", ask: { ask_id: "a", prompt: "Again?", choices: [], text: false } },
    { type: "ask", ask: { ask_id: "b", prompt: "Run b?", choices: [], text: true } },
  ]);
  w.end("a");
  expect(w.setAsks).toHaveBeenLastCalledWith([
    { type: "ask", ask: { ask_id: "b", prompt: "Run b?", choices: [], text: true } },
  ]);
  w.dispose();
});

it.each(["disconnect", "expiry"])("clears open Asks on %s", (event) => {
  const w = build();
  w.ask(frame("a", 1000));
  if (event === "disconnect") w.state();
  else vi.advanceTimersByTime(1000);
  expect(w.setAsks).toHaveBeenLastCalledWith([]);
  w.dispose();
  expect(w.off).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it.each([
  { sent: true, expected: [[]] },
  {
    sent: false,
    expected: [[{ type: "ask", ask: { ask_id: "a", prompt: "Run a?", choices: [], text: true } }]],
  },
])("answers through the socket and publishes the retained list on sent=$sent", ({
  sent,
  expected,
}) => {
  const w = build();
  w.ask(frame("a"));
  w.sendAnswer.mockReturnValue(sent);
  expect(w.answer({ ask_id: "a", choice: "once", text: "yes" })).toBe(sent);
  expect(w.sendAnswer).toHaveBeenCalledExactlyOnceWith({
    type: "answer",
    ask_id: "a",
    choice: "once",
    text: "yes",
  });
  expect(w.setAsks.mock.calls.at(-1)).toEqual(expected);
  w.dispose();
});

it("rejects an unknown Ask without sending an Answer", () => {
  const w = build();
  w.ask(frame("a"));
  expect(w.answer({ ask_id: "other", text: "yes" })).toBe(false);
  expect(w.sendAnswer.mock.calls).toEqual([]);
  w.dispose();
});

it.each([
  "tail arrival",
  "tail expiry",
])("keeps the head field focus and draft through %s", (event) => {
  const w = build(true);
  w.ask(frame("a"));
  if (event === "tail expiry") w.ask(frame("b", 1000));
  const field = w.mount.querySelector("textarea")!;
  field.focus();
  field.value = "my draft";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  if (event === "tail arrival") w.ask(frame("b"));
  else vi.advanceTimersByTime(1000);
  expect(document.activeElement).toBe(field);
  expect(w.mount.querySelector("textarea")?.value).toBe("my draft");
  w.dispose();
});
