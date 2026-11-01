/**
 * The terminal pane: its head (owner and shell state, title and Close) over the parts it is handed
 * (the access line and the screens), or one line of text while there is no terminal.
 */

import "./terminal-pane.css";
import type { Terminal } from "../../contract";
import { getLocale, t } from "../i18n";
import { ownerLine, type PresetLookup, paneState, stateWord } from "./terminal-meta";

function head(terminal: Terminal, preset: PresetLookup, onClose: () => void): HTMLElement {
  const el = document.createElement("header");
  el.className = "yui-threads-pane__head";
  const line = document.createElement("div");
  line.className = "yui-threads-pane__line";
  line.append(ownerLine(terminal, preset), stateWord(paneState(terminal)));
  const titleLine = document.createElement("div");
  titleLine.className = "yui-terminal-pane__title";
  const title = document.createElement("h2");
  title.tabIndex = -1;
  title.textContent = terminal.title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "yui-terminal-pane__close yui-threads-button";
  close.textContent = t("terminal.close");
  close.setAttribute("aria-label", t("terminal.close_aria"));
  close.addEventListener("click", onClose);
  titleLine.append(title, close);
  el.append(line, titleLine);
  return el;
}

export function createTerminalPane(deps: {
  /** The narrow layout's way back to the list, leading the head. */
  back: HTMLElement;
  /** Laid under the head while a terminal shows. */
  parts: HTMLElement[];
  preset: PresetLookup;
  onClose(id: string): void;
}): { el: HTMLElement; show(terminal: Terminal | undefined): void } {
  const el = document.createElement("article");
  el.className = "yui-threads-pane yui-terminal-pane";
  const headSlot = document.createElement("div");
  headSlot.className = "yui-terminal-pane__head";
  const empty = document.createElement("p");
  empty.className = "yui-terminal-pane__empty";
  el.append(headSlot, ...deps.parts, empty);
  let shownKey: string | null = null;

  return {
    el,
    show(terminal) {
      el.setAttribute("aria-label", t("terminal.pane_aria"));
      el.classList.toggle("is-empty", !terminal);
      empty.textContent = t("terminal.empty_pane");
      deps.back.textContent = t("threads.back");
      const owner = terminal?.owner.kind === "preset" ? deps.preset(terminal.owner.presetId) : null;
      const key = terminal
        ? JSON.stringify([terminal.id, terminal.title, terminal.exitCode, owner, getLocale()])
        : null;
      if (key === shownKey) return;
      shownKey = key;
      if (!terminal) {
        headSlot.replaceChildren();
        return;
      }
      const built = head(terminal, deps.preset, () => deps.onClose(terminal.id));
      built.prepend(deps.back);
      headSlot.replaceChildren(built);
    },
  };
}
