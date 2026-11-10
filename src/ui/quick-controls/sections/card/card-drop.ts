import type { SubscribeFileDrop } from "../../../../io/window/file-drop/file-drop";
import type { Logger } from "../../../../logger";
import type { CardIo } from "./card-io";

export function createCardDrop(deps: {
  root: HTMLElement;
  subscribe: SubscribeFileDrop;
  isImporting(): boolean;
  importDropped: CardIo["importDropped"];
  log: Logger;
}): { dispose(): void } {
  const el = document.createElement("div");
  el.className = "yui-card-drop";
  deps.root.append(el);
  void deps.subscribe((e) => {
    if (e.type === "drop") void deps.importDropped().then(() => el.classList.add("is-refused"));
  });
  return { dispose: () => el.remove() };
}
