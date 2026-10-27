/** The quick card in its own window beside the character: its head, tiles and rows, and how it opens and closes. */

import "./quick-card.css";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { createLogger } from "../../logger";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { subscribe as subscribeLocale, t } from "../i18n";
import { CROSS_SVG } from "../quick-controls/constants";
import type { SwitchRow } from "../quick-controls/switch-row";
import { avatarEl } from "../unified/avatar";
import { createRows, type PickerPort } from "./rows";
import { createTiles, type ListenPort } from "./tiles";
import { transportLine } from "./transport-line";

const log = createLogger("quick-card");

export interface QuickCard {
  el: HTMLElement;
  /** Shows the card, painting the current store values. */
  open(): void;
  close(): void;
  isOpen(): boolean;
  /** Runs the callback each time the card closes, whatever closed it. */
  onClose(cb: () => void): () => void;
  /** The card's head: the drag handle the window moves by. */
  onHeadPointerDown(cb: (event: PointerEvent) => void): () => void;
  dispose(): void;
}

export function createQuickCard(deps: {
  mount: HTMLElement;
  entry(): PresetEntry;
  subscribeEntry(cb: () => void): () => void;
  transport(): { api: ChatTransport; push?: PushSocketState };
  onTransport(cb: () => void): () => void;
  tiles: { voice: SwitchRow; bubble: SwitchRow; unified: SwitchRow };
  /** Null outside the main window: voice input belongs to main. */
  listen: ListenPort | null;
  body: PickerPort;
  voice: PickerPort;
  resetConversation(): void;
  /** Null for main, which cannot be turned off. */
  turnOff: (() => void) | null;
  openAllSettings(): void;
}): QuickCard {
  const el = document.createElement("div");
  el.className = "yui-qcard";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "yui-qcard-name");
  el.tabIndex = -1;
  let open = false;
  let disposed = false;
  const closeListeners = new Set<() => void>();
  const headListeners = new Set<(event: PointerEvent) => void>();

  // The card's contents, rebuilt in the new language on a locale change.
  function build() {
    el.innerHTML = `
    <div class="yui-qcard__head">
      <span class="yui-qcard__face"></span>
      <span class="yui-qcard__id">
        <span class="yui-qcard__name" id="yui-qcard-name"></span>
        <span class="yui-qcard__transport"></span>
      </span>
      <button class="yui-qcard__close" type="button" aria-label="${t("quick_card.close")}">${CROSS_SVG}</button>
    </div>
    <div class="yui-qcard__body">
      <button class="yui-qcard__all" type="button">${t("quick_card.all_settings")}</button>
    </div>`;
    const q = <T extends Element>(selector: string): T => el.querySelector<T>(selector)!;
    const tiles = createTiles({ rows: deps.tiles, listen: deps.listen, log });
    const rows = createRows({
      body: deps.body,
      voice: deps.voice,
      resetConversation: () => {
        deps.resetConversation();
        close();
      },
      turnOff: deps.turnOff
        ? () => {
            deps.turnOff?.();
            close();
          }
        : null,
      log,
    });
    q(".yui-qcard__body").prepend(tiles.el, rows.el);
    q(".yui-qcard__all").addEventListener("click", () => {
      deps.openAllSettings();
      close();
    });
    q(".yui-qcard__close").addEventListener("click", () => close());
    // The head drags the window; its × keeps its click.
    q(".yui-qcard__head").addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("button")) return;
      for (const cb of headListeners) cb(event as PointerEvent);
    });
    return {
      face: q<HTMLElement>(".yui-qcard__face"),
      name: q<HTMLElement>(".yui-qcard__name"),
      transport: q<HTMLElement>(".yui-qcard__transport"),
      rows,
      dispose: () => {
        tiles.dispose();
        rows.dispose();
      },
    };
  }
  let parts = build();

  function paintHead(): void {
    const entry = deps.entry();
    parts.face.replaceChildren(avatarEl(entry, 30));
    parts.name.textContent = entry.name;
    parts.transport.textContent = transportLine(deps.transport());
  }

  // Escape closes the card only, never the window or a surface behind it.
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  const unsubscribes = [
    deps.subscribeEntry(paintHead),
    deps.onTransport(paintHead),
    // An open card rebuilds in place; a closed one picks the language up at the next open.
    subscribeLocale(() => {
      const wasOpen = open;
      parts.dispose();
      parts = build();
      if (wasOpen) {
        paintHead();
        parts.rows.paint();
      }
    }),
  ];

  const onOutsidePointer = (e: PointerEvent): void => {
    if (!el.contains(e.target as Node)) close();
  };

  function show(): void {
    if (disposed || open) return;
    open = true;
    paintHead();
    parts.rows.paint();
    deps.mount.append(el);
    document.addEventListener("pointerdown", onOutsidePointer, true);
    el.focus({ preventScroll: true });
  }

  function close(): void {
    if (!open) return;
    open = false;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    parts.rows.disarm();
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    el.remove();
    for (const cb of closeListeners) cb();
  }

  return {
    el,
    open() {
      show();
    },
    close,
    isOpen: () => open,
    onClose(cb) {
      closeListeners.add(cb);
      return () => closeListeners.delete(cb);
    },
    onHeadPointerDown(cb) {
      headListeners.add(cb);
      return () => headListeners.delete(cb);
    },
    dispose() {
      close();
      disposed = true;
      parts.dispose();
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
