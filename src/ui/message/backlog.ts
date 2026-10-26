/** Backlog — the current session's earlier lines, opened above the bubble's box by a toggle on its bottom edge. */

import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import { subscribe as subscribeLocale, t } from "../i18n";
import type { SpeechBubble } from "./speech-bubble";

/** Where the backlog reads the session from. */
export interface BacklogSource {
  /** The current session's lines, oldest first; read again on each open. */
  read(): readonly ChatHistoryEntry[];
  characterName(): string;
}

interface BacklogOptions extends BacklogSource {
  /** The box's frame: the panel opens above it and the toggle rides its bottom edge. */
  mount: HTMLElement;
  /** Held open while the backlog shows; each show re-checks the toggle and each hide closes the backlog. */
  bubble: Pick<SpeechBubble, "keepOpen" | "onShown">;
}

export interface Backlog {
  dispose(): void;
}

export function createBacklog({ mount, read, characterName, bubble }: BacklogOptions): Backlog {
  const panel = document.createElement("div");
  panel.className = "yui-bubble__backlog";
  panel.hidden = true;
  const title = document.createElement("div");
  title.className = "yui-bubble__backlog-title";
  const list = document.createElement("ol");
  list.className = "yui-bubble__backlog-list";
  panel.append(title, list);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "yui-bubble__backlog-toggle";
  mount.before(panel);
  mount.append(toggle);
  let isOpen = false;

  function line(entry: ChatHistoryEntry): HTMLLIElement {
    const li = document.createElement("li");
    const who = document.createElement("span");
    who.className = "yui-bubble__backlog-who";
    who.textContent = entry.role === "user" ? t("bubble.you") : characterName();
    const text = document.createElement("span");
    text.className = "yui-bubble__backlog-text";
    text.textContent = entry.text;
    li.append(who, text);
    return li;
  }

  function applyLabels(): void {
    title.textContent = t("bubble.backlog");
    toggle.textContent = t(isOpen ? "bubble.backlog_hide" : "bubble.backlog");
    toggle.setAttribute("aria-expanded", String(isOpen));
  }

  function setOpen(open: boolean): void {
    if (open === isOpen) return;
    isOpen = open;
    if (open) list.replaceChildren(...read().map(line));
    panel.hidden = !open;
    if (open) list.scrollTop = list.scrollHeight;
    applyLabels();
    bubble.keepOpen(open);
  }

  const onToggle = (): void => setOpen(!isOpen);
  toggle.addEventListener("click", onToggle);
  // The toggle shows only while the session has lines.
  const unsubscribeBubble = bubble.onShown((shown) => {
    if (shown) toggle.hidden = read().length === 0;
    else setOpen(false);
  });
  // Surfaces aren't remounted on locale change, so the labels are (re)applied here.
  applyLabels();
  const unsubscribeLocale = subscribeLocale(applyLabels);

  return {
    dispose() {
      unsubscribeBubble();
      unsubscribeLocale();
      toggle.removeEventListener("click", onToggle);
      panel.remove();
      toggle.remove();
    },
  };
}
