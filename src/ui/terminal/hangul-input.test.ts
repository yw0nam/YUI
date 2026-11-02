// @vitest-environment jsdom
/** hangul-input.test.ts — Hangul typed through WebKit's in-place IME edits reaches the PTY a whole syllable at a time; other input passes through. */

import { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it } from "vitest";
import { attachHangulInput } from "./hangul-input";
import trace from "./hangul-input.trace.json";

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
})) as never;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as never;
HTMLCanvasElement.prototype.getContext = (() => null) as never;

/** One recorded or synthetic event: `value` is the textarea's text once an `input` lands. */
interface Step {
  type: string;
  key?: string;
  keyCode?: number;
  data?: string;
  inputType?: string;
  value?: string;
  isComposing?: boolean;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 2));
let cleanup: (() => void) | undefined;
afterEach(() => cleanup?.());

/** A real xterm in `host`, with or without the module, recording what reaches the PTY. */
function mount(withModule = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const term = new Terminal({ cols: 80, rows: 10 });
  const detach = withModule ? attachHangulInput({ host, xterm: term }) : () => {};
  term.open(host);
  const sent: string[] = [];
  term.onData((data) => sent.push(data));
  const textarea = host.querySelector("textarea")!;
  textarea.focus();
  cleanup = () => {
    detach();
    term.dispose();
    host.remove();
  };

  async function play(steps: Step[]): Promise<void> {
    for (const step of steps) {
      if (step.type.startsWith("composition")) {
        textarea.dispatchEvent(new CompositionEvent(step.type, { data: step.data, bubbles: true }));
      } else if (step.type === "input" || step.type === "beforeinput") {
        if (step.type === "input" && step.value !== undefined) textarea.value = step.value;
        textarea.dispatchEvent(
          new InputEvent(step.type, {
            data: step.data,
            inputType: step.inputType,
            isComposing: step.isComposing ?? false,
            bubbles: true,
            composed: true,
            cancelable: step.type === "beforeinput",
          }),
        );
      } else {
        const event = new KeyboardEvent(step.type, {
          key: step.key,
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "keyCode", { value: step.keyCode });
        Object.defineProperty(event, "which", { value: step.keyCode });
        textarea.dispatchEvent(event);
      }
      await tick();
    }
    await tick();
  }

  return { host, textarea, sent, play };
}

/** `세` started as a new syllable, as WebKit's 2-Set IME delivers it. */
const typeSe: Step[] = [
  { type: "input", data: "세", inputType: "insertText", value: "세" },
  { type: "keydown", key: "ㅔ", keyCode: 229 },
];

describe("attachHangulInput", () => {
  it("sends each syllable of the captured WebKit trace once it is complete", async () => {
    const screen = mount();
    await screen.play(trace.events);
    // The trace ends with `셍` still being typed.
    expect(screen.sent).toEqual(["안", "녕", "하"]);
  });

  it("sends the pending syllable before Enter", async () => {
    const screen = mount();
    await screen.play([...typeSe, { type: "keydown", key: "Enter", keyCode: 13 }]);
    expect(screen.sent).toEqual(["세", "\r"]);
  });

  it("keeps the syllable held across a Shift inside it", async () => {
    const screen = mount();
    await screen.play([
      { type: "input", data: "ㅎ", inputType: "insertText", value: "ㅎ" },
      { type: "keydown", key: "ㅎ", keyCode: 229 },
      { type: "input", data: "하", inputType: "insertReplacementText", value: "하" },
      { type: "keydown", key: "ㅏ", keyCode: 229 },
      { type: "keydown", key: "Shift", keyCode: 16 },
      { type: "input", data: "했", inputType: "insertReplacementText", value: "했" },
      { type: "keydown", key: "ㅆ", keyCode: 229 },
      { type: "keydown", key: "Enter", keyCode: 13 },
    ]);
    expect(screen.sent).toEqual(["했", "\r"]);
  });

  it.each([
    ["deleteContentBackward", undefined],
    ["insertReplacementText", ""],
  ])("drops the held syllable that a %s input deletes", async (inputType, data) => {
    const screen = mount();
    await screen.play([
      { type: "input", data: "ㅇ", inputType: "insertText", value: "ㅇ" },
      { type: "keydown", key: "ㅇ", keyCode: 229 },
      { type: "input", data, inputType, value: "" },
      { type: "keydown", key: "Backspace", keyCode: 229 },
      { type: "keydown", key: "Enter", keyCode: 13 },
    ]);
    expect(screen.sent).toEqual(["\r"]);
    expect(screen.host.querySelector<HTMLElement>(".yui-terminal-preedit")?.hidden).toBe(true);
  });

  it("sends the pending syllable when the terminal loses focus", async () => {
    const screen = mount();
    await screen.play(typeSe);
    screen.textarea.blur();
    expect(screen.sent).toEqual(["세"]);
  });

  it("leaves plain ASCII typing as xterm handles it", async () => {
    const screen = mount();
    await screen.play([
      { type: "keydown", key: "a", keyCode: 65 },
      { type: "keypress", key: "a", keyCode: 97 },
      { type: "input", data: "a", inputType: "insertText", value: "a" },
      { type: "keyup", key: "a", keyCode: 65 },
    ]);
    expect(screen.sent).toEqual(["a"]);
  });

  it("leaves an IME that fires composition events as xterm handles it", async () => {
    const japanese: Step[] = [
      { type: "keydown", key: "n", keyCode: 229 },
      { type: "compositionstart", data: "" },
      { type: "compositionupdate", data: "ｎ" },
      {
        type: "input",
        data: "ｎ",
        inputType: "insertCompositionText",
        value: "ｎ",
        isComposing: true,
      },
      { type: "keydown", key: "i", keyCode: 229 },
      { type: "compositionupdate", data: "に" },
      {
        type: "input",
        data: "に",
        inputType: "insertCompositionText",
        value: "に",
        isComposing: true,
      },
      { type: "keydown", key: "Enter", keyCode: 229 },
      { type: "compositionend", data: "に" },
      { type: "input", data: "に", inputType: "insertText", value: "に" },
    ];
    const without = mount(false);
    await without.play(japanese);
    const expected = without.sent;
    cleanup?.();
    const screen = mount();
    await screen.play(japanese);
    expect(expected).toEqual(["に"]);
    expect(screen.sent).toEqual(["に"]);
  });

  it("shows the pending syllable at the cursor until it is sent", async () => {
    const screen = mount();
    await screen.play(typeSe);
    const view = screen.host.querySelector<HTMLElement>(".yui-terminal-preedit");
    expect(view?.hidden).toBe(false);
    expect(view?.textContent).toBe("세");
    await screen.play([{ type: "keydown", key: "Enter", keyCode: 13 }]);
    expect(view?.hidden).toBe(true);
  });
});
