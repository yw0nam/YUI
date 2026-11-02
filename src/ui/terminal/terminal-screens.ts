/**
 * One xterm per terminal in the snapshot, created when it first appears and attached at once, kept
 * until the terminal goes. Only the selected one shows; it opens into the page the first time it
 * shows, and its fit sets the one size every terminal and its PTY take. The font-size keys set one
 * font size on every screen and refit.
 */

import "@xterm/xterm/css/xterm.css";
import "./terminal-screens.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import type { Terminal } from "../../contract";
import { createLogger } from "../../logger";
import { isMacOS } from "../../tauri-env";
import { t } from "../i18n";
import { attachHangulInput } from "./hangul-input";
import { fontSizeFor } from "./terminal-font";
import { terminalFont, terminalTheme, watchTheme } from "./terminal-theme";

const log = createLogger("terminal-screens");

/** The PTY size before a window reports one; pairs with the store's default. */
const DEFAULT_SIZE = { cols: 120, rows: 32 };
/** The PTY's scrollback, so an xterm scrolls as far back as a read sees. */
const SCROLLBACK_LINES = 2_000;
/** The exit line in bright black, which the theme sets to Text mute. */
const exitLine = (code: number): string =>
  `\r\n\x1b[90m${t("terminal.exited_line", { code })}\x1b[0m\r\n`;

interface Screen {
  xterm: Xterm;
  fit: FitAddon;
  host: HTMLElement;
  detachHangul: () => void;
  opened: boolean;
  exited: boolean;
}

export function createTerminalScreens(deps: {
  attach(id: string, onBytes: (bytes: Uint8Array) => void): Promise<void>;
  input(id: string, data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  /** Every screen's font size in px at the start. */
  fontSize: number;
  onFontSize(px: number): void;
}): {
  el: HTMLElement;
  sync(terminals: Terminal[]): void;
  /** Shows `id`'s screen, or none. */
  show(id: string | null): void;
  focus(): void;
  dispose(): void;
} {
  const el = document.createElement("div");
  el.className = "yui-terminal-screens";
  const screens = new Map<string, Screen>();
  let size = { ...DEFAULT_SIZE };
  let shownId: string | null = null;
  let fontSize = deps.fontSize;

  function setFontSize(px: number): void {
    if (px === fontSize) return;
    fontSize = px;
    for (const screen of screens.values()) screen.xterm.options.fontSize = px;
    deps.onFontSize(px);
    // A font change resizes no element, so the observer stays quiet.
    refit();
  }

  function create(id: string): Screen {
    const xterm = new Xterm({
      ...size,
      fontFamily: terminalFont(),
      fontSize,
      scrollback: SCROLLBACK_LINES,
      theme: terminalTheme(),
    });
    // The font-size keys never reach the shell; every other key does.
    xterm.attachCustomKeyEventHandler((event) => {
      const next = fontSizeFor(event, fontSize, isMacOS());
      if (next === null) return true;
      if (event.type === "keydown") {
        event.preventDefault();
        setFontSize(next);
      }
      return false;
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    xterm.onData((data) => {
      deps.input(id, data).catch((error) => log.warn("input_failed", { error: String(error) }));
    });
    const host = document.createElement("div");
    host.className = "yui-terminal-screen";
    host.hidden = true;
    el.append(host);
    const detachHangul = attachHangulInput({ host, xterm });
    deps
      .attach(id, (bytes) => xterm.write(bytes))
      .catch((error) => log.warn("attach_failed", { error: String(error) }));
    return { xterm, fit, host, detachHangul, opened: false, exited: false };
  }

  // The shown screen's fit sets every terminal's size, and the PTYs' once it changes.
  function refit(): void {
    const shown = shownId ? screens.get(shownId) : undefined;
    if (!shown?.opened) return;
    const next = shown.fit.proposeDimensions();
    if (!next || !(next.cols > 1 && next.rows > 1)) return;
    if (next.cols === size.cols && next.rows === size.rows) return;
    size = { cols: next.cols, rows: next.rows };
    for (const screen of screens.values()) screen.xterm.resize(size.cols, size.rows);
    deps
      .resize(size.cols, size.rows)
      .catch((error) => log.warn("resize_failed", { error: String(error) }));
  }

  function show(id: string | null): void {
    shownId = id;
    for (const [key, screen] of screens) screen.host.hidden = key !== id;
    const shown = id ? screens.get(id) : undefined;
    // An xterm opened while hidden measures no cell, so it opens once it lays out.
    if (shown && !shown.opened && el.getClientRects().length > 0) {
      shown.xterm.open(shown.host);
      shown.opened = true;
    }
    refit();
  }

  const observer = new ResizeObserver(() => refit());
  observer.observe(el);
  const offTheme = watchTheme(() => {
    const theme = terminalTheme();
    for (const screen of screens.values()) screen.xterm.options.theme = theme;
  });

  return {
    el,
    sync(terminals) {
      for (const [id, screen] of screens) {
        if (terminals.some((term) => term.id === id)) continue;
        screen.detachHangul();
        screen.xterm.dispose();
        screen.host.remove();
        screens.delete(id);
      }
      for (const terminal of terminals) {
        let screen = screens.get(terminal.id);
        if (!screen) {
          screen = create(terminal.id);
          screens.set(terminal.id, screen);
        }
        if (terminal.exitCode === null || screen.exited) continue;
        screen.exited = true;
        screen.xterm.write(exitLine(terminal.exitCode));
        screen.xterm.options.disableStdin = true;
      }
    },
    show,
    focus() {
      if (shownId) screens.get(shownId)?.xterm.focus();
    },
    dispose() {
      observer.disconnect();
      offTheme();
      for (const screen of screens.values()) {
        screen.detachHangul();
        screen.xterm.dispose();
      }
      screens.clear();
    },
  };
}
