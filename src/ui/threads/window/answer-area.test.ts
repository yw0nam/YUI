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
    draft: { picks: [], text },
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

it("renders the prompt as Markdown under the heading the area is labelled by", () => {
  const { area } = build({ ...ASK, prompt: "**Dangerous** command\n\n```\nrm -rf build\n```" });
  const prompt = area.el.querySelector("#yui-threads-answer-prompt")!;

  expect([
    prompt.getAttribute("role"),
    prompt.querySelector("strong")?.textContent,
    prompt.querySelector("pre")?.textContent,
  ]).toEqual(["heading", "Dangerous", "rm -rf build\n"]);
});

it("sizes the field to its text, and an empty field to one line whatever its placeholder wraps to", () => {
  const frames: FrameRequestCallback[] = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => frames.push(cb));
  // jsdom lays nothing out; an empty field's scrollHeight counts its wrapped placeholder in Chromium.
  vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get").mockReturnValue(89);
  const { field, type } = build({
    ...ASK,
    placeholder: "Reply with the number, the option text, or your own answer.",
  });
  for (const frame of frames) frame(0);
  const empty = field!.style.height;
  type("two\nlines");

  expect([empty, field!.style.height]).toEqual(["", "91px"]);
});

it("toggles multiple picks with checks, a count and danger feedback", () => {
  const { area, send } = build({ ...ASK, multiple: true });
  const group = area.el.querySelector('[role="group"]')!;
  expect(area.el.querySelector(`#${group.getAttribute("aria-describedby")}`)?.textContent).toBe(
    "Choose one or more",
  );
  expect([...area.el.children].map((child) => child.className)).toEqual([
    "yui-threads-answer__head",
    "yui-threads-answer__multiple",
    "yui-threads-answer__choices",
    "yui-threads-answer__composer",
  ]);
  expect([send.textContent, send.disabled]).toEqual(["Send", true]);
  area.pick(1);
  expect([send.textContent, send.classList.contains("is-danger")]).toEqual(["Deny", true]);
  area.pick(0);
  expect(send.textContent).toBe("Send 2");
  expect(
    [...group.querySelectorAll("button")].map((b) => [
      b.getAttribute("aria-pressed"),
      b.querySelector("svg")?.getAttribute("aria-hidden"),
    ]),
  ).toEqual([
    ["true", "true"],
    ["true", "true"],
  ]);
  area.pick(1);
  expect([send.textContent, send.classList.contains("is-danger")]).toEqual(["Allow", false]);
  area.pick(0);
  expect([send.textContent, send.disabled]).toEqual(["Send", true]);
});

it.each([
  [[1, 0], "", { choices: ["allow", "deny"] }],
  [[1, 0], " why ", { choices: ["allow", "deny"], text: "why" }],
  [[0], "", { choices: ["allow"] }],
  [[], " why ", { text: "why" }],
])("sends multiple picks %j in Ask order with text %j", (indices, text, expected) => {
  const { area, send, onSend } = build({ ...ASK, multiple: true }, text);
  for (const index of indices) area.pick(index);
  send.click();
  expect(onSend.mock.calls).toEqual([[expected]]);
});
