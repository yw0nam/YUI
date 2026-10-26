/**
 * The quick card — the pet window's right-click card beside the character: the head (face, name,
 * transport line, ×), the toggle tiles, the Body and Reference voice selects, the conversation
 * reset that asks first, Turn off, and All settings…. Escape, a pointerdown outside it and the
 * window's blur close it.
 */

import "./quick-card.css";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import { createLogger } from "../../logger";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { t } from "../i18n";
import type { SwitchRow } from "../quick-controls/switch-row";
import { avatarEl } from "../unified/avatar";
import { CARD_MARGIN, placeCard } from "./place";
import { createTiles, type ListenPort } from "./tiles";
import { transportLine } from "./transport-line";

const log = createLogger("quick-card");

const CROSS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

/** A native select's options and the store it applies to at once. */
export interface PickerPort {
  options(): { id: string; label: string }[];
  current(): string;
  select(id: string): Promise<void>;
  subscribe(cb: () => void): () => void;
}

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
      <button class="yui-qcard__close" type="button" aria-label="${t("quick_card.close")}">${CROSS}</button>
    </div>
    <div class="yui-qcard__body">
      <div class="yui-qcard__rows">
        <label class="yui-qcard__row"><span>${t("quick_card.body")}</span><select class="yui-qcard__select"></select></label>
        <label class="yui-qcard__row"><span>${t("quick_card.voice_ref")}</span><select class="yui-qcard__select"></select></label>
        <div class="yui-qcard__row"><span>${t("quick_card.conversation")}</span><button class="yui-qcard__reset" type="button">${t("quick_card.reset")}</button></div>
        <div class="yui-qcard__confirm" hidden>
          <span class="yui-qcard__confirm-q">${t("quick_card.reset_confirm")}</span>
          <button class="yui-qcard__pill yui-qcard__cancel" type="button">${t("quick_card.cancel")}</button>
          <button class="yui-qcard__pill yui-qcard__confirm-go" type="button">${t("quick_card.reset_go")}</button>
        </div>
        ${deps.turnOff ? `<button class="yui-qcard__row yui-qcard__turnoff" type="button">${t("quick_card.turn_off")}</button>` : ""}
      </div>
      <button class="yui-qcard__all" type="button">${t("quick_card.all_settings")}</button>
    </div>`;
  const q = <T extends Element>(selector: string): T => el.querySelector<T>(selector)!;
  const face = q<HTMLElement>(".yui-qcard__face");
  const name = q<HTMLElement>(".yui-qcard__name");
  const transportEl = q<HTMLElement>(".yui-qcard__transport");
  const [bodySelect, voiceSelect] = el.querySelectorAll<HTMLSelectElement>(".yui-qcard__select");
  const resetBtn = q<HTMLButtonElement>(".yui-qcard__reset");
  const confirmEl = q<HTMLElement>(".yui-qcard__confirm");

  const tiles = createTiles({ rows: deps.tiles, listen: deps.listen, log });
  q(".yui-qcard__body").prepend(tiles.el);

  function paintHead(): void {
    const entry = deps.entry();
    face.replaceChildren(avatarEl(entry, 30));
    name.textContent = entry.name;
    transportEl.textContent = transportLine(deps.transport());
  }

  const pickers = [
    { select: bodySelect!, port: deps.body },
    { select: voiceSelect!, port: deps.voice },
  ];
  function paintPicker({ select, port }: (typeof pickers)[number]): void {
    const current = port.current();
    select.replaceChildren(
      ...port.options().map((o) => new Option(o.label, o.id, false, o.id === current)),
    );
  }
  for (const picker of pickers) {
    picker.select.addEventListener("change", () => {
      void picker.port
        .select(picker.select.value)
        .catch((err) => log.warn("select_failed", { error: String(err) }))
        .finally(() => paintPicker(picker));
    });
  }

  function showConfirm(show: boolean): void {
    confirmEl.hidden = !show;
    resetBtn.hidden = show;
    // The confirmation grows the card; it stays inside the window.
    if (open) place();
  }
  resetBtn.addEventListener("click", () => showConfirm(true));
  q(".yui-qcard__cancel").addEventListener("click", () => showConfirm(false));
  q(".yui-qcard__confirm-go").addEventListener("click", () => {
    deps.resetConversation();
    showConfirm(false);
  });
  el.querySelector(".yui-qcard__turnoff")?.addEventListener("click", () => deps.turnOff?.());
  q(".yui-qcard__all").addEventListener("click", () => deps.openAllSettings());
  q(".yui-qcard__close").addEventListener("click", () => close());
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
    ...pickers.map((picker) => picker.port.subscribe(() => paintPicker(picker))),
  ];

  function place(): void {
    const view = {
      width: window.innerWidth,
      height: Math.min(window.innerHeight, deps.visibleViewport?.get() ?? Number.POSITIVE_INFINITY),
    };
    el.style.setProperty("--yui-qcard-max-h", `${view.height - 2 * CARD_MARGIN}px`);
    // Layout size: the pop animation's scale must not shrink the measured card.
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
      for (const picker of pickers) paintPicker(picker);
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
    // A reopen never lands on the destructive button.
    confirmEl.hidden = true;
    resetBtn.hidden = false;
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
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
