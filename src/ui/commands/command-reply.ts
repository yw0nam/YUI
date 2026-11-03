import "./command-reply.css";
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
  function clear(): void {
    card.hidden = true;
  }
  close.addEventListener("click", clear);
  labels();
  const offLocale = subscribe(labels);
  return {
    pending(name: string): void {
      title.textContent = `/${name}`;
      empty = false;
      body.replaceChildren();
      running.hidden = false;
      labels();
      card.hidden = false;
    },
    settle(text: string): void {
      empty = text === "";
      running.hidden = true;
      body.replaceChildren(...entryMarkdown(text));
      labels();
    },
    clear,
    dispose(): void {
      offLocale();
      close.removeEventListener("click", clear);
      card.remove();
    },
  };
}
