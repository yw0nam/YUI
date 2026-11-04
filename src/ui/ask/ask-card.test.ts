// @vitest-environment jsdom
/** ask-card.test.ts — the pet window's Ask card: which Ask shows, what Send does, and when an Ask closes. */

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AskFrame } from "../../io/chat/push/push-frames";
import { setLocale } from "../i18n";
import { createAskCard } from "./ask-card";

function frame(id: string, prompt = `Run ${id}?`, expires_at = 60_000): AskFrame {
  return {
    type: "ask",
    ask: {
      ask_id: id,
      prompt,
      choices: [
        { id: "once", label: "Allow Once", tone: "primary" },
        { id: "deny", label: "Deny", tone: "danger" },
      ],
      text: true,
    },
    expires_at,
  };
}

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  vi.useFakeTimers({ now: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

function build(answered = true) {
  const mount = document.createElement("div");
  document.body.append(mount);
  const onAnswer = vi.fn(() => answered);
  const card = createAskCard({ mount, onAnswer });
  const el = mount.querySelector<HTMLElement>(".yui-ask-card")!;
  const prompt = () => el.querySelector(".yui-threads-answer__prompt")?.textContent ?? null;
  const choices = () => [
    ...el.querySelectorAll<HTMLButtonElement>(".yui-threads-answer__choices button"),
  ];
  const answer = (index: number) => {
    choices()[index]!.click();
    el.querySelector<HTMLButtonElement>(".yui-threads-answer__send")!.click();
  };
  return { card, el, onAnswer, prompt, choices, answer };
}

it("renders the supplied head and waits for set after an answer", () => {
  const { card, onAnswer, prompt, answer } = build();
  card.set([frame("a"), frame("b")]);
  expect(prompt()).toBe("Run a?");

  answer(0);

  expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ ask_id: "a", choice: "once" });
  expect(prompt()).toBe("Run a?");
  card.set([frame("b")]);
  expect(prompt()).toBe("Run b?");
});

it("renders a changed head and the supplied next Ask", () => {
  const { card, el, prompt, answer } = build();
  card.set([frame("a"), frame("b")]);
  card.set([frame("a", "Run a again?"), frame("b")]);
  expect(prompt()).toBe("Run a again?");

  answer(0);
  expect(prompt()).toBe("Run a again?");
  card.set([frame("b")]);
  expect(prompt()).toBe("Run b?");
  answer(0);
  expect(el.hidden).toBe(false);
  card.set([]);
  expect(el.hidden).toBe(true);
});

it("keeps an Ask whose answer was not sent and says why", () => {
  const { card, el, prompt, choices, answer } = build(false);
  card.set([frame("a")]);

  answer(1);

  expect([
    prompt(),
    el.querySelector(".yui-threads-answer__error")?.textContent,
    choices()[1]!.getAttribute("aria-pressed"),
    el.querySelector<HTMLButtonElement>(".yui-threads-answer__send")!.disabled,
  ]).toEqual(["Run a?", "Couldn't send: the connection is down", "true", false]);
});

it("counts down to zero and waits for set at expiry", () => {
  const { card, el, prompt } = build();
  card.set([frame("a", "Run a?", 5_000), frame("b", "Run b?", 9_000)]);

  vi.advanceTimersByTime(4_999);
  expect([prompt(), el.querySelector("[role=timer]")?.textContent]).toEqual([
    "Run a?",
    "0:01 left",
  ]);
  vi.advanceTimersByTime(1);
  expect([prompt(), el.querySelector("[role=timer]")?.textContent]).toEqual([
    "Run a?",
    "0:00 left",
  ]);
  vi.advanceTimersByTime(4_000);
  expect(el.hidden).toBe(false);
  card.set([]);
  expect(el.hidden).toBe(true);
});

it("keeps an Ask without expires_at open and shows no time left", () => {
  const { card, el, prompt } = build();
  const { expires_at: _none, ...open } = frame("a");
  card.set([open]);

  vi.advanceTimersByTime(2 * 60 * 60 * 1000);
  expect([prompt(), el.querySelector<HTMLElement>("[role=timer]")?.hidden]).toEqual([
    "Run a?",
    true,
  ]);
});

it("picks a choice with a number key while focus is inside the card, but not from the text field", () => {
  const { card, el, choices } = build();
  card.set([frame("a")]);
  const press = (target: Element, key: string) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  press(el.querySelector("textarea")!, "1");
  press(document.body, "1");
  expect(choices().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false"]);

  press(choices()[0]!, "2");
  expect(choices().map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true"]);
});

it("an empty set hides the card", () => {
  const { card, el } = build();
  card.set([frame("a"), frame("b")]);
  expect(el.hidden).toBe(false);
  card.set([]);
  expect(el.hidden).toBe(true);
});

it.each(["same object", "equal content"])("keeps focus and draft for a %s head", (kind) => {
  const { card, el } = build();
  const head = frame("a");
  card.set([head]);
  const field = el.querySelector("textarea")!;
  field.focus();
  field.value = "my draft";
  field.dispatchEvent(new Event("input", { bubbles: true }));
  card.set([kind === "same object" ? head : structuredClone(head), frame("b")]);
  expect(document.activeElement).toBe(field);
  expect(el.querySelector("textarea")?.value).toBe("my draft");
});

it("marks the prompt while more of it sits below its visible part", () => {
  const { card, el } = build();
  card.set([frame("a")]);
  const head = el.querySelector<HTMLElement>(".yui-threads-answer__head")!;
  Object.defineProperties(head, {
    scrollHeight: { value: 300 },
    clientHeight: { value: 100 },
  });
  const scrollTo = (top: number) => {
    head.scrollTop = top;
    head.dispatchEvent(new Event("scroll"));
    return head.classList.contains("is-clipped");
  };

  expect([scrollTo(0), scrollTo(200)]).toEqual([true, false]);
});
