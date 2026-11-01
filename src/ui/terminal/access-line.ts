/**
 * The access line under the terminal pane's head while a preset holds access: its face and name,
 * the last command (lit once when a new one lands), and Take back. Take back leaves a note that
 * stays two seconds, then folds its grid row away while it fades.
 */

import "./access-line.css";
import type { Terminal } from "../../contract";
import { createLogger } from "../../logger";
import { getLocale, t } from "../i18n";
import { avatarEl } from "../unified/avatar";
import type { PresetLookup } from "./terminal-meta";

const log = createLogger("access-line");

/** How long the taken-back note stays before it folds. */
const NOTE_MS = 2_000;
/** Pairs with the fold's transition in access-line.css. */
const FOLD_MS = 200;

function still(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function holderRow(
  terminal: Terminal,
  holder: string,
  preset: PresetLookup,
  onTakeBack: () => void,
) {
  const who = document.createElement("span");
  who.className = "yui-terminal-access__who";
  const name = document.createElement("strong");
  name.textContent = preset(holder).name;
  who.append(avatarEl(preset(holder), 20), t("terminal.access"), " ", name);

  const cmd = document.createElement("span");
  cmd.className = "yui-terminal-access__cmd";
  const label = document.createElement("span");
  label.className = "yui-terminal-access__label";
  label.textContent = t("terminal.last_command");
  const value = document.createElement(terminal.lastCommand ? "code" : "span");
  value.textContent = terminal.lastCommand ?? t("terminal.no_command");
  if (terminal.lastCommand) value.title = `${t("terminal.last_command")}: ${terminal.lastCommand}`;
  cmd.append(label, value);

  const takeBack = document.createElement("button");
  takeBack.type = "button";
  takeBack.textContent = t("terminal.take_back");
  takeBack.addEventListener("click", onTakeBack);
  return [who, cmd, takeBack];
}

export function createAccessLine(deps: {
  preset: PresetLookup;
  takeBack(id: string): Promise<void>;
}): { el: HTMLElement; show(terminal: Terminal | undefined): void; dispose(): void } {
  const el = document.createElement("div");
  el.className = "yui-terminal-access";
  const clip = document.createElement("div");
  clip.className = "yui-terminal-access__clip";
  const row = document.createElement("div");
  row.className = "yui-terminal-access__row";
  clip.append(row);
  el.append(clip);

  let shownKey: string | null = null;
  let shown: { id: string; holder: string; command: string | null } | null = null;
  // The terminal whose access was just taken back, while its note shows.
  let noteFor: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clear(): void {
    clearTimeout(timer);
    noteFor = null;
    shownKey = null;
    shown = null;
    el.classList.remove("is-leaving");
    el.hidden = true;
    row.replaceChildren();
  }

  function note(id: string): void {
    noteFor = id;
    shownKey = null;
    const text = document.createElement("span");
    text.className = "yui-terminal-access__note";
    text.textContent = t("terminal.taken_back");
    row.replaceChildren(text);
    timer = setTimeout(() => {
      if (still()) return clear();
      el.classList.add("is-leaving");
      timer = setTimeout(clear, FOLD_MS);
    }, NOTE_MS);
  }

  function show(terminal: Terminal | undefined): void {
    if (noteFor !== null && noteFor === terminal?.id && !terminal.access) return;
    if (noteFor !== null) clear();
    if (!terminal?.access) {
      clear();
      return;
    }
    const holder = terminal.access;
    const key = JSON.stringify([
      terminal.id,
      holder,
      terminal.lastCommand,
      deps.preset(holder),
      getLocale(),
    ]);
    if (key === shownKey) return;
    const lit =
      shown?.id === terminal.id &&
      shown.holder === holder &&
      terminal.lastCommand !== null &&
      shown.command !== terminal.lastCommand;
    shownKey = key;
    shown = { id: terminal.id, holder, command: terminal.lastCommand };
    el.hidden = false;
    row.replaceChildren(
      ...holderRow(terminal, holder, deps.preset, () => {
        deps
          .takeBack(terminal.id)
          .catch((error) => log.warn("take_back_failed", { error: String(error) }));
        note(terminal.id);
      }),
    );
    if (lit) row.querySelector("code")?.classList.add("is-new");
  }

  clear();
  return { el, show, dispose: () => clearTimeout(timer) };
}
