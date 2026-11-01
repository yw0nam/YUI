/** xterm's colours from the theme tokens, and a watch on the window's theme switch. */

import type { ITheme } from "@xterm/xterm";

/** The code-span mono stack (thread-pane.css). */
export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, monospace';

/** Panel ground, Text ink, and the tokens' colours for the ANSI slots they fit; xterm keeps the rest. */
export function terminalTheme(root: HTMLElement = document.documentElement): ITheme {
  const style = getComputedStyle(root);
  const token = (name: string): string | undefined =>
    style.getPropertyValue(name).trim() || undefined;
  return {
    background: token("--yui-panel-bg"),
    foreground: token("--yui-text"),
    cursor: token("--yui-text-dim"),
    cursorAccent: token("--yui-panel-bg"),
    red: token("--yui-danger"),
    brightRed: token("--yui-danger"),
    green: token("--yui-ok"),
    brightGreen: token("--yui-ok"),
    yellow: token("--yui-accent-ink"),
    brightYellow: token("--yui-accent-ink"),
    brightBlack: token("--yui-text-mute"),
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
