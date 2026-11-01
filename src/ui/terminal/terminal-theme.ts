/** xterm's colours from the theme tokens, and a watch on the window's theme switch. */

import type { ITheme } from "@xterm/xterm";

/** The code-span mono stack (thread-pane.css). */
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, monospace';

const ANSI_SLOTS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

/** `brightBlack` → `--yui-ansi-bright-black`. */
const ansiToken = (slot: string): string =>
  `--yui-ansi-${slot.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** Panel ground, Text ink, and each ANSI slot from its theme token. */
export function terminalTheme(root: HTMLElement = document.documentElement): ITheme {
  const style = getComputedStyle(root);
  const token = (name: string): string | undefined =>
    style.getPropertyValue(name).trim() || undefined;
  return {
    background: token("--yui-panel-bg"),
    foreground: token("--yui-text"),
    cursor: token("--yui-text-dim"),
    cursorAccent: token("--yui-panel-bg"),
    ...Object.fromEntries(ANSI_SLOTS.map((slot) => [slot, token(ansiToken(slot))])),
  };
}

/** Calls `cb` whenever the window's theme switches. */
export function watchTheme(
  cb: () => void,
  root: HTMLElement = document.documentElement,
): () => void {
  const observer = new MutationObserver(cb);
  observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
