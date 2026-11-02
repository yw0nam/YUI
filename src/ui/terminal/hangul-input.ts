/**
 * Hangul for one screen. WebKit's Korean IME fires no composition events: it inserts a new syllable
 * as `insertText` and edits it in place as `insertReplacementText`, and xterm forwards only the
 * first. This holds the syllable being typed, shows it at the cursor, and sends it to the PTY once
 * the next syllable starts, a key that is not an IME key goes down, or the terminal loses focus.
 */

import type { IDisposable, Terminal as Xterm } from "@xterm/xterm";

const HANGUL = /^[ᄀ-ᇿ㄰-㆏가-힣]+$/;
/** The keyCode WebKit gives a key the IME takes. */
const IME_KEY = 229;

/** Listens on `host`, an ancestor of xterm's textarea, so it runs before xterm; returns the detach. */
export function attachHangulInput(deps: { host: HTMLElement; xterm: Xterm }): () => void {
  const { host, xterm } = deps;
  const view = document.createElement("div");
  view.className = "yui-terminal-preedit";
  view.hidden = true;
  host.append(view);
  let pending = "";
  let render: IDisposable | undefined;

  function place(): void {
    const screen = host.querySelector<HTMLElement>(".xterm-screen");
    const buffer = xterm.buffer.active;
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
    view.hidden = !pending || !screen || row < 0 || row >= xterm.rows;
    if (view.hidden || !screen) return;
    const cell = screen.getBoundingClientRect();
    const origin = host.getBoundingClientRect();
    const width = cell.width / xterm.cols;
    const height = cell.height / xterm.rows;
    view.textContent = pending;
    view.style.left = `${cell.left - origin.left + Math.min(buffer.cursorX, xterm.cols - 1) * width}px`;
    view.style.top = `${cell.top - origin.top + row * height}px`;
    view.style.height = view.style.lineHeight = `${height}px`;
    view.style.fontSize = `${xterm.options.fontSize}px`;
  }

  function hold(syllable: string): void {
    pending = syllable;
    // The PTY's echo moves the cursor after a send, so the view follows each render.
    if (pending) render ??= xterm.onRender(place);
    else {
      render?.dispose();
      render = undefined;
    }
    place();
  }

  function send(): void {
    if (!pending) return;
    const syllable = pending;
    hold("");
    xterm.input(syllable, true);
  }

  function onInput(event: Event): void {
    const { data, inputType, isComposing } = event as InputEvent;
    if (!data || isComposing) return;
    if (inputType === "insertReplacementText" && pending) {
      hold(data);
      event.stopPropagation();
    } else if (inputType === "insertText") {
      send();
      if (!HANGUL.test(data)) return;
      hold(data);
      event.stopPropagation();
    }
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.keyCode !== IME_KEY) send();
  }

  host.addEventListener("input", onInput, true);
  host.addEventListener("keydown", onKeyDown, true);
  host.addEventListener("focusout", send, true);
  return () => {
    host.removeEventListener("input", onInput, true);
    host.removeEventListener("keydown", onKeyDown, true);
    host.removeEventListener("focusout", send, true);
    render?.dispose();
    view.remove();
  };
}
