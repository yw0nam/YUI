/** The Terminal tab's list pane: the New terminal button, then one row per terminal, newest first. */

import "./terminal-list.css";
import { t } from "../i18n";
import { timeEl } from "../threads/window/relative-time";
import {
  ownerLine,
  PLUS_SVG,
  type PresetLookup,
  rowState,
  stateWord,
  titleLine,
} from "./terminal-meta";
import { createTerminalNav, type TerminalNav } from "./terminal-nav";

export function createTerminalList(deps: {
  preset: PresetLookup;
  now(): number;
  onSelect(id: string): void;
  onNew(): void;
}): TerminalNav {
  return createTerminalNav({
    className: "yui-threads-list",
    html: `
      <div class="yui-terminal-list__top">
        <button type="button" class="yui-terminal-list__new yui-threads-button" data-new>${PLUS_SVG}<span></span></button>
      </div>
      <div class="yui-threads-list__rows" data-items></div>
    `,
    label: () => t("terminal.list_aria"),
    labelNew(button) {
      button.querySelector("span")!.textContent = t("terminal.new");
    },
    item(terminal, requests) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "yui-threads-row";
      const meta = document.createElement("span");
      meta.className = "yui-threads-row__meta";
      meta.append(
        stateWord(rowState(terminal, requests, deps.preset)),
        timeEl(terminal.openedAt, deps.now()),
      );
      el.append(
        ownerLine(terminal, deps.preset),
        titleLine(terminal, document.createElement("strong")),
        meta,
      );
      return el;
    },
    empty: { className: "yui-threads-list__empty", text: () => t("terminal.empty_list") },
    onSelect: deps.onSelect,
    onNew: deps.onNew,
  });
}
