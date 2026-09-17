/**
 * Delegation chip — the push transport's one status surface beside the avatar.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the delegations list the push socket
 * feeds and the state that socket reports. While the socket is ready it carries the running
 * count and its tap toggles the list popover; while it is anything else it carries one
 * lost-connection wording and its tap opens the settings window, where the cause is named.
 * A held press folds the chip to its dot, and the fold is a per-device choice.
 */

import "./delegation-chip.css";
import type { DelegationItem, PushSocketState } from "../../io/chat/push-socket";
import type { DelegationChipSettingsStore } from "../../io/settings/delegation-chip-settings";
import { subscribe as subscribeLocale, t } from "../i18n";
import { afterFadeOut } from "../notices/fade-out";
import { DELEGATION_REFRESH_MS, renderDelegationRows } from "./delegation-rows";

/** How long a press must hold before it folds the chip. */
const FOLD_PRESS_MS = 500;

/** Where the push socket stands, as the chip reads it — the real socket or a window's mirror. */
export interface PushStatePort {
  getState(): PushSocketState;
  onState(cb: (state: PushSocketState) => void): () => void;
}

/** The delegations list as the chip reads it — the pet window's store or a window's mirror. */
export interface DelegationsPort {
  get(): DelegationItem[];
  runningCount(): number;
  subscribe(cb: (items: DelegationItem[]) => void): () => void;
}

interface DelegationChipOptions {
  mount: HTMLElement;
  store: DelegationsPort;
  /** Per-device fold choice. */
  collapsed: DelegationChipSettingsStore;
  /** The transport the chip reports on. Anything but ready reads as a lost connection. */
  pushState: PushStatePort;
  /** Opens the settings window at the chat section — what a tap does while the connection is lost. */
  onOpenSettings(): void;
  /** Starts hidden, for a window that has nothing to report yet. */
  suppressed?: boolean;
  now?: () => number;
}

export interface DelegationChip {
  el: HTMLElement;
  /** Hides the chip entirely — the popped-out surfaces carry it instead. */
  setSuppressed(suppressed: boolean): void;
  /** Closes the open list — the reasoning chip's panel opened instead. */
  closeList(): void;
  /** Fires once per closed → open list transition. Returns its unsubscriber. */
  onListOpen(cb: () => void): () => void;
  dispose(): void;
}

export function createDelegationChip({
  mount,
  store,
  collapsed,
  pushState,
  onOpenSettings,
  suppressed: initialSuppressed = false,
  now = Date.now,
}: DelegationChipOptions): DelegationChip {
  const el = document.createElement("div");
  el.className = "yui-deleg";
  el.hidden = true;
  el.innerHTML = `
    <button type="button" class="yui-deleg__chip" aria-expanded="false">
      <span class="yui-deleg__dot" aria-hidden="true"></span>
      <span class="yui-deleg__label"></span>
      <span class="yui-deleg__count" aria-hidden="true"></span>
    </button>
    <div class="yui-deleg__list" hidden>
      <div class="yui-deleg__list-title"></div>
      <div class="yui-deleg__rows"></div>
    </div>
  `;
  mount.appendChild(el);

  const chipBtn = el.querySelector<HTMLButtonElement>(".yui-deleg__chip")!;
  const labelEl = el.querySelector<HTMLElement>(".yui-deleg__label")!;
  const countEl = el.querySelector<HTMLElement>(".yui-deleg__count")!;
  const listEl = el.querySelector<HTMLElement>(".yui-deleg__list")!;
  const listTitleEl = el.querySelector<HTMLElement>(".yui-deleg__list-title")!;
  const rowsEl = el.querySelector<HTMLElement>(".yui-deleg__rows")!;

  let visible = false;
  let listOpen = false;
  let suppressed = initialSuppressed;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let cancelListFade: (() => void) | null = null;
  let cancelHideFade: (() => void) | null = null;
  const listOpenSubs = new Set<() => void>();

  function clearRefreshTimer(): void {
    if (refreshTimer !== null) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }

  function onListKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") closeList();
  }

  function openList(): void {
    if (listOpen) return;
    listOpen = true;
    chipBtn.setAttribute("aria-expanded", "true");
    renderDelegationRows(rowsEl, store.get(), now());
    listEl.hidden = false;
    requestAnimationFrame(() => listEl.classList.add("is-open"));
    document.addEventListener("keydown", onListKeydown);
    for (const cb of [...listOpenSubs]) cb();
  }

  function closeList(): void {
    if (!listOpen) return;
    listOpen = false;
    chipBtn.setAttribute("aria-expanded", "false");
    listEl.classList.remove("is-open");
    document.removeEventListener("keydown", onListKeydown);
    cancelListFade?.();
    cancelListFade = afterFadeOut(listEl, () => {
      cancelListFade = null;
      if (!listOpen) listEl.hidden = true;
    });
  }

  function hide(): void {
    if (!visible) return;
    visible = false;
    clearRefreshTimer();
    closeList();
    el.classList.remove("is-visible");
    cancelHideFade?.();
    cancelHideFade = afterFadeOut(el, () => {
      cancelHideFade = null;
      if (!visible) el.hidden = true;
    });
  }

  function show(): void {
    if (visible) return;
    visible = true;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-visible"));
  }

  function refresh(): void {
    // Every state but ready reads the same here; the cause is named in the settings window.
    const lost = pushState.getState().kind !== "ready";
    el.classList.toggle("is-lost", lost);
    if (suppressed) {
      hide();
      return;
    }
    if (lost) {
      clearRefreshTimer();
      closeList();
      chipBtn.removeAttribute("aria-expanded");
      labelEl.textContent = t("deleg.chip_lost");
      countEl.textContent = "";
      show();
      return;
    }
    if (!chipBtn.hasAttribute("aria-expanded")) {
      chipBtn.setAttribute("aria-expanded", String(listOpen));
    }
    const items = store.get();
    const running = store.runningCount();
    if (running === 0) {
      hide();
      return;
    }
    labelEl.textContent =
      running === 1 ? t("deleg.chip_running_one") : t("deleg.chip_running", { n: running });
    countEl.textContent = String(running);
    if (listOpen) renderDelegationRows(rowsEl, items, now());
    show();
    // A chip already visible from the lost state still needs the timer the lost branch cleared.
    if (refreshTimer === null) refreshTimer = setInterval(refresh, DELEGATION_REFRESH_MS);
  }

  function applyCollapsed(isFolded: boolean): void {
    el.classList.toggle("is-mini", isFolded);
    if (isFolded) closeList();
  }

  // A press held past FOLD_PRESS_MS folds; its release's click is swallowed so it doesn't
  // also toggle the list.
  let foldTimer: ReturnType<typeof setTimeout> | null = null;
  let folded = false;

  function clearFold(): void {
    if (foldTimer !== null) {
      clearTimeout(foldTimer);
      foldTimer = null;
    }
  }

  function onPointerDown(): void {
    clearFold();
    folded = false;
    foldTimer = setTimeout(() => {
      foldTimer = null;
      folded = true;
      collapsed.setCollapsed(true);
    }, FOLD_PRESS_MS);
  }

  function onPointerEnd(): void {
    clearFold();
  }

  function onClick(): void {
    if (folded) {
      folded = false;
      return;
    }
    if (collapsed.get().collapsed) {
      collapsed.setCollapsed(false);
      return;
    }
    if (pushState.getState().kind !== "ready") {
      onOpenSettings();
      return;
    }
    if (listOpen) closeList();
    else openList();
  }

  chipBtn.addEventListener("pointerdown", onPointerDown);
  chipBtn.addEventListener("pointerup", onPointerEnd);
  chipBtn.addEventListener("pointercancel", onPointerEnd);
  chipBtn.addEventListener("pointerleave", onPointerEnd);
  chipBtn.addEventListener("click", onClick);

  listTitleEl.textContent = t("deleg.list_title");
  // Created outside main.ts's locale remount set, so the labels re-apply here.
  const unsubscribeLocale = subscribeLocale(() => {
    listTitleEl.textContent = t("deleg.list_title");
    refresh();
  });

  const unsubscribeStore = store.subscribe(() => refresh());
  const unsubscribePushState = pushState.onState(() => refresh());
  const unsubscribeCollapsed = collapsed.subscribe((s) => applyCollapsed(s.collapsed));
  applyCollapsed(collapsed.get().collapsed);
  refresh();

  function dispose(): void {
    clearRefreshTimer();
    clearFold();
    document.removeEventListener("keydown", onListKeydown);
    cancelListFade?.();
    cancelHideFade?.();
    unsubscribeStore();
    unsubscribePushState();
    unsubscribeCollapsed();
    unsubscribeLocale();
    listOpenSubs.clear();
    chipBtn.removeEventListener("pointerdown", onPointerDown);
    chipBtn.removeEventListener("pointerup", onPointerEnd);
    chipBtn.removeEventListener("pointercancel", onPointerEnd);
    chipBtn.removeEventListener("pointerleave", onPointerEnd);
    chipBtn.removeEventListener("click", onClick);
    el.remove();
  }

  return {
    el,
    setSuppressed(next): void {
      if (suppressed === next) return;
      suppressed = next;
      refresh();
    },
    closeList,
    onListOpen(cb): () => void {
      listOpenSubs.add(cb);
      return () => {
        listOpenSubs.delete(cb);
      };
    },
    dispose,
  };
}
