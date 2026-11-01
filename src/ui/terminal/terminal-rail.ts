/** The Terminal tab's rail, the list folded to 56px: New terminal, then each terminal's owner mark, an Amber dot while a request waits on it. */

import { t } from "../i18n";
import { ownerMark, PLUS_SVG, type PresetLookup, rowState } from "./terminal-meta";
import { createTerminalNav, type TerminalNav } from "./terminal-nav";

export function createTerminalRail(deps: {
  preset: PresetLookup;
  onSelect(id: string): void;
  onNew(): void;
}): TerminalNav {
  return createTerminalNav({
    className: "yui-threads-rail",
    html: `
      <div class="yui-threads-rail__top">
        <button type="button" class="yui-threads-rail__tab" data-new>${PLUS_SVG}</button>
      </div>
      <div class="yui-threads-rail__list" data-items></div>
    `,
    label: () => t("terminal.rail_aria"),
    labelNew(button) {
      button.setAttribute("aria-label", t("terminal.new"));
      button.title = t("terminal.new");
    },
    item(terminal, requests) {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "yui-threads-rail__item";
      const name = `${terminal.title} · ${rowState(terminal, requests, deps.preset).text}`;
      el.setAttribute("aria-label", name);
      el.title = name;
      const mark = ownerMark(terminal, deps.preset, 22);
      mark.setAttribute("aria-hidden", "true");
      el.append(mark);
      if (requests.some((r) => r.terminalId === terminal.id)) {
        const dot = document.createElement("span");
        dot.className = "yui-threads-rail__dot";
        dot.setAttribute("aria-hidden", "true");
        el.append(dot);
      }
      return el;
    },
    empty: { className: "yui-threads-rail__empty", text: () => t("threads.rail_empty") },
    onSelect: deps.onSelect,
    onNew: deps.onNew,
  });
}
