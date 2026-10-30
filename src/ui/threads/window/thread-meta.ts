/** The source line and the state a list row, a rail item and the thread pane lead with. */

import "./thread-meta.css";
import type { Thread } from "../../../contract";
import { t } from "../../i18n";
import { threadSource } from "../thread-source";

/** A Thread's state in words. */
export function stateText(thread: Thread): string {
  return t(`threads.state_${thread.state.replace("-", "_")}`);
}

/** The state word a row and the pane show. */
export function stateWord(thread: Thread): HTMLElement {
  const el = document.createElement("span");
  el.className = `yui-threads-state is-${thread.state}`;
  el.textContent = stateText(thread);
  return el;
}

/** The source mark and name a row and the pane lead with. */
export function sourceLine(source: string): HTMLElement {
  const { name, mark } = threadSource(source);
  const el = document.createElement("span");
  el.className = "yui-threads-source";
  const markEl = document.createElement("span");
  markEl.className = "yui-threads-source__mark";
  markEl.setAttribute("aria-hidden", "true");
  markEl.textContent = mark;
  el.append(markEl, name);
  return el;
}
