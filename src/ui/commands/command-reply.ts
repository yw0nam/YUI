import "./command-reply.css";
import type { CommandReplyState } from "../../io/bridge/message/message-bridge";
import { subscribe, t } from "../i18n";
import { entryMarkdown } from "../threads/window/entry-markdown";

export function createCommandReply({ mount }: { mount: HTMLElement }) {
  const card = document.createElement("section");
  card.className = "yui-cmd-reply";
  card.setAttribute("aria-live", "polite");
  card.hidden = true;
  const head = document.createElement("div");
  head.className = "yui-cmd-reply__head";
  const title = document.createElement("span");
  const running = document.createElement("span");
  running.className = "yui-cmd-reply__running";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "yui-cmd-reply__close";
  close.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const body = document.createElement("div");
  body.className = "yui-cmd-reply__body";
  head.append(title, running, close);
  card.append(head, body);
  mount.append(card);
  let empty = false;
  function labels(): void {
    running.textContent = running.hidden ? "" : t("command.running");
    close.setAttribute("aria-label", t("command.close"));
    if (empty) body.textContent = t("command.empty");
  }
  const closeHandlers: Array<() => void> = [];
  function requestClose(): void {
    for (const cb of closeHandlers) cb();
  }
  close.addEventListener("click", requestClose);
  labels();
  const offLocale = subscribe(labels);
  return {
    show(state: CommandReplyState): void {
      if (state.kind === "clear") {
        card.hidden = true;
        return;
      }
      title.textContent = `/${state.name}`;
      empty = state.kind === "settled" && state.text === "";
      running.hidden = state.kind !== "pending";
      body.replaceChildren(...(state.kind === "settled" ? entryMarkdown(state.text) : []));
      labels();
      card.hidden = false;
    },
    onClose(cb: () => void): void {
      closeHandlers.push(cb);
    },
    dispose(): void {
      offLocale();
      close.removeEventListener("click", requestClose);
      closeHandlers.length = 0;
      card.remove();
    },
  };
}
