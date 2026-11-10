/**
 * The drop cover: while a file is over the settings window it fills the window, refuses a drop
 * that is not one card file before anything is read, and starts the import of one that is.
 */

import type { FileDropEvent, SubscribeFileDrop } from "../../../../io/window/file-drop/file-drop";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";
import type { CardIo } from "./card-io";
import "./card-drop.css";

/** How long a refusal stays in the cover before it fades. */
const REFUSAL_MS = 2400;

const CARD_EXTENSIONS = new Set(["yui", "png", "json"]);

const DROP_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 4.5v10M8 10.5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15v2.8c0 .9.8 1.7 1.7 1.7h11.6c.9 0 1.7-.8 1.7-1.7V15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ERR_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v5.5M12 16.2v.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

export function createCardDrop(deps: {
  /** The panel root; the cover fills the window over every page. */
  root: HTMLElement;
  subscribe: SubscribeFileDrop;
  isImporting(): boolean;
  importDropped: CardIo["importDropped"];
  log: Logger;
}): { dispose(): void } {
  const el = document.createElement("div");
  el.className = "yui-card-drop";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `<div class="yui-card-drop__frame"><div class="yui-card-drop__msg">${DROP_SVG}<p class="yui-card-drop__title"></p><p class="yui-card-drop__sub"></p></div><div class="yui-card-drop__err" role="alert">${ERR_SVG}<div></div></div></div>`;
  const titleEl = el.querySelector<HTMLElement>(".yui-card-drop__title")!;
  const subEl = el.querySelector<HTMLElement>(".yui-card-drop__sub")!;
  const errEl = el.querySelector<HTMLElement>(".yui-card-drop__err > div")!;
  deps.root.append(el);

  let disposed = false;
  let refusalTimer: ReturnType<typeof setTimeout> | undefined;

  const show = (look: "" | "is-busy" | "is-refused"): void => {
    clearTimeout(refusalTimer);
    el.className = `yui-card-drop is-on ${look}`.trim();
    el.setAttribute("aria-hidden", "false");
  };
  // The look stays through the fade; the next show replaces it.
  const hide = (): void => {
    clearTimeout(refusalTimer);
    el.classList.remove("is-on");
    el.setAttribute("aria-hidden", "true");
  };
  const refuse = (key: string): void => {
    errEl.textContent = t(key);
    show("is-refused");
    refusalTimer = setTimeout(hide, REFUSAL_MS);
  };

  async function onDrop(paths: string[]): Promise<void> {
    hide();
    if (deps.isImporting()) {
      deps.log.warn("card_drop_refused", { reason: "busy" });
      return;
    }
    if (paths.length !== 1) {
      deps.log.warn("card_drop_refused", { reason: "multi" });
      return refuse("card.drop_multi");
    }
    // As Rust's `Path::extension`: a file name whose only dot leads it has no extension.
    const name = paths[0]!.split(/[\\/]/).pop()!;
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    if (!CARD_EXTENSIONS.has(ext)) {
      deps.log.warn("card_drop_refused", { reason: "extension" });
      return refuse("card.drop_extension");
    }
    const outcome = await deps.importDropped();
    if (disposed) return;
    if (outcome === "unreadable") refuse("card.import_error");
    else if (outcome === "failed") refuse("card.import_failed");
  }

  function onEvent(e: FileDropEvent): void {
    if (disposed) return;
    if (e.type === "leave") hide();
    else if (e.type === "drop") void onDrop(e.paths);
    else {
      const busy = deps.isImporting();
      titleEl.textContent = t(busy ? "card.drop_busy_title" : "card.drop_title");
      subEl.textContent = t(busy ? "card.drop_busy_sub" : "card.drop_sub");
      show(busy ? "is-busy" : "");
    }
  }

  el.addEventListener("click", hide);
  const unlisten = deps.subscribe(onEvent).catch((err: unknown) => {
    deps.log.warn("file_drop_listen_failed", { error: String(err) });
    return () => {};
  });

  return {
    dispose(): void {
      disposed = true;
      clearTimeout(refusalTimer);
      el.removeEventListener("click", hide);
      el.remove();
      void unlisten.then((off) => off());
    },
  };
}
