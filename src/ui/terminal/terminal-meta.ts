/** The owner line and the state word a terminal's row, rail item and pane head lead with. */

import "./terminal-meta.css";
import type { AccessRequest, Terminal } from "../../contract";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import { TERMINAL_GLYPH } from "../threads/glyphs";
import { avatarEl } from "../unified/avatar";

/** A preset's stored entry, or one named by its id. */
export type PresetLookup = (id: string) => PresetEntry;

export const PLUS_SVG =
  '<svg class="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

export interface StateWord {
  text: string;
  tone: "" | "is-input-required" | "is-exited";
}

/** The terminal glyph for the user's terminal, the opening preset's face otherwise. */
export function ownerMark(terminal: Terminal, preset: PresetLookup, sizePx: number): HTMLElement {
  if (terminal.owner.kind === "preset") return avatarEl(preset(terminal.owner.presetId), sizePx);
  const el = document.createElement("span");
  el.className = "yui-terminal-glyph";
  el.innerHTML = TERMINAL_GLYPH;
  return el;
}

export function ownerLine(terminal: Terminal, preset: PresetLookup): HTMLElement {
  const el = document.createElement("span");
  el.className = "yui-threads-source";
  const mark = document.createElement("span");
  mark.className = "yui-threads-source__mark";
  mark.setAttribute("aria-hidden", "true");
  mark.append(ownerMark(terminal, preset, 20));
  const { owner } = terminal;
  el.append(mark, owner.kind === "user" ? t("terminal.owner_user") : preset(owner.presetId).name);
  return el;
}

/** A row's state: a waiting request first, then an exit, then who holds access. */
export function rowState(
  terminal: Terminal,
  requests: AccessRequest[],
  preset: PresetLookup,
): StateWord {
  if (requests.some((r) => r.terminalId === terminal.id))
    return { text: t("terminal.state_asks"), tone: "is-input-required" };
  if (terminal.exitCode !== null) return { text: t("terminal.state_exited"), tone: "is-exited" };
  if (terminal.access)
    return { text: t("terminal.state_access", { name: preset(terminal.access).name }), tone: "" };
  return { text: t("terminal.state_running"), tone: "" };
}

/** The pane head's state: the shell's own, since the card and the access line speak for the rest. */
export function paneState(terminal: Terminal): StateWord {
  return terminal.exitCode !== null
    ? { text: t("terminal.state_exited"), tone: "is-exited" }
    : { text: t("terminal.state_running"), tone: "" };
}

/** The title in `heading` with the terminal's id after it, the name agents use for it. */
export function titleLine(terminal: Terminal, heading: HTMLElement): HTMLElement {
  const el = document.createElement("span");
  el.className = "yui-terminal-title";
  heading.textContent = terminal.title;
  const id = document.createElement("span");
  id.className = "yui-terminal-id";
  id.textContent = terminal.id;
  el.append(heading, id);
  return el;
}

export function stateWord(state: StateWord): HTMLElement {
  const el = document.createElement("span");
  el.className = `yui-threads-state ${state.tone}`.trim();
  el.textContent = state.text;
  return el;
}
