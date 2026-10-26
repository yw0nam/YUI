/** The quick card beside the character: its head, tiles and rows, and how it opens, places and closes. */

import "./quick-card.css";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { createLogger } from "../../logger";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import { CROSS_SVG } from "../quick-controls/constants";
import type { SwitchRow } from "../quick-controls/switch-row";
import { avatarEl } from "../unified/avatar";
import { CARD_MARGIN, placeCard } from "./place";
import { createRows, type PickerPort } from "./rows";
import { createTiles, type ListenPort } from "./tiles";
import { transportLine } from "./transport-line";

const log = createLogger("quick-card");

export interface QuickCard {
  el: HTMLElement;
  /** Opens at the point, or at the window's centre without one. */
  open(at?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
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
  /** The on-screen height of the window, refreshed before each open; the card stays inside it. */
  visibleViewport?: { get(): number; refresh(): Promise<void> };
  onOpen?: () => void;
}): QuickCard {
  const el = document.createElement("div");
  el.className = "yui-qcard";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-labelledby", "yui-qcard-name");
  el.tabIndex = -1;
  let open = false;
  let anchor: { x: number; y: number } | undefined;
  let disposed = false;
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
  const face = q<HTMLElement>(".yui-qcard__face");
  const name = q<HTMLElement>(".yui-qcard__name");
  const transportEl = q<HTMLElement>(".yui-qcard__transport");

  const tiles = createTiles({ rows: deps.tiles, listen: deps.listen, log });
  const rows = createRows({
    body: deps.body,
    voice: deps.voice,
    resetConversation: deps.resetConversation,
    turnOff: deps.turnOff,
    // The confirmation grows the card; it stays inside the window.
    onResize: () => {
      if (open) place();
    },
    log,
  });
  q(".yui-qcard__body").prepend(tiles.el, rows.el);

  function paintHead(): void {
    const entry = deps.entry();
    face.replaceChildren(avatarEl(entry, 30));
    name.textContent = entry.name;
    transportEl.textContent = transportLine(deps.transport());
  }

  q(".yui-qcard__all").addEventListener("click", () => deps.openAllSettings());
  q(".yui-qcard__close").addEventListener("click", () => close());
  // Escape closes the card only, never the window or a surface behind it.
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });

  const unsubscribes = [deps.subscribeEntry(paintHead), deps.onTransport(paintHead)];

  function place(): void {
    const view = {
      width: window.innerWidth,
      height: Math.min(window.innerHeight, deps.visibleViewport?.get() ?? Number.POSITIVE_INFINITY),
    };
    el.style.setProperty("--yui-qcard-max-h", `${view.height - 2 * CARD_MARGIN}px`);
    // Layout size: the entry animation's scale must not shrink the measured card.
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const at = anchor ?? {
      x: (view.width - size.width) / 2,
      y: (view.height - size.height) / 2,
    };
    const p = placeCard(at, size, view);
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  }

  const onOutsidePointer = (e: PointerEvent): void => {
    if (!el.contains(e.target as Node)) close();
  };
  const onBlur = (): void => close();

  function show(at?: { x: number; y: number }): void {
    if (disposed) return;
    anchor = at;
    if (!open) {
      open = true;
      paintHead();
      rows.paint();
      deps.mount.append(el);
      document.addEventListener("pointerdown", onOutsidePointer, true);
      window.addEventListener("blur", onBlur);
      el.focus({ preventScroll: true });
      deps.onOpen?.();
    }
    place();
  }

  function close(): void {
    if (!open) return;
    open = false;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    window.removeEventListener("blur", onBlur);
    rows.disarm();
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    el.remove();
  }

  return {
    el,
    open(at) {
      const viewport = deps.visibleViewport;
      if (!viewport) {
        show(at);
        return;
      }
      void viewport.refresh().then(() => show(at));
    },
    close,
    isOpen: () => open,
    dispose() {
      close();
      disposed = true;
      tiles.dispose();
      rows.dispose();
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
