// @vitest-environment jsdom
/** answer-area.test.ts — the pinned answer area: choices, the field's Enter, the send label, and what an Answer carries. */

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./answer-area.css", () => ({}));

import type { ThreadAsk } from "../../../contract";
import { setLocale } from "../../i18n";
import { createAnswerArea } from "./answer-area";

const ASK: ThreadAsk = {
  ask_id: "a1",
  prompt: "Allow this command?",
  choices: [
    { id: "allow", label: "Allow", tone: "primary" },
    { id: "deny", label: "Deny", tone: "danger" },
  ],
  text: true,
};

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
});

function build(ask: ThreadAsk = ASK, text = "") {
  const onSend = vi.fn();
  const area = createAnswerArea({
    ask,
    draft: { text },
    error: null,
    sending: false,
    onDraft: vi.fn(),
    onSend,
  });
  document.body.append(area.el);
  const field = area.el.querySelector("textarea");
  const send = area.el.querySelector<HTMLButtonElement>(".yui-threads-answer__send")!;
  const type = (value: string) => {
    field!.value = value;
    field!.dispatchEvent(new Event("input"));
  };
  return { area, onSend, field, send, type };
}

it.each([
  ["Enter sends", { key: "Enter" }, [[{ choice: "deny", text: "use pnpm" }]]],
  ["Shift+Enter does not send", { key: "Enter", shiftKey: true }, []],
  ["Enter during IME composition does not send", { key: "Enter", isComposing: true }, []],
])("%s", (_name, init, calls) => {
  const { area, onSend, field, type } = build();
  area.pick(1);
  type("  use pnpm ");

  field!.dispatchEvent(new KeyboardEvent("keydown", { ...init, cancelable: true }));

  expect(onSend.mock.calls).toEqual(calls);
});

it("labels send with the picked choice, else Send, and disables it until there is something to send", () => {
  const { area, send, type } = build();
  expect([send.textContent, send.disabled]).toEqual(["Send", true]);

  area.pick(1);
  expect([send.textContent, send.disabled, send.classList.contains("is-danger")]).toEqual([
    "Deny",
    false,
    true,
  ]);

  area.pick(1);
  type("hello");
  expect([send.textContent, send.disabled]).toEqual(["Send", false]);
});

it("takes no text when the ask refuses it", () => {
  const { area, onSend, field, send } = build({ ...ASK, text: false }, "left over");
  expect(field).toBe(null);

  area.pick(0);
  send.click();

  expect(onSend).toHaveBeenCalledExactlyOnceWith({ choice: "allow" });
});
