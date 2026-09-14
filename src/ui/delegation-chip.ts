/**
 * Delegation chip — the backend's background work as a pill beside the avatar.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the delegations list the push socket
 * feeds. Tap toggles the list popover, a held press folds the chip to its dot, and the fold
 * is a per-device choice.
 */

import "./delegation-chip.css";
import type { DelegationChipSettingsStore } from "../io/delegation-chip-settings";
import type { DelegationsStore } from "../io/delegations-store";
import { DELEGATION_REFRESH_MS, renderDelegationRows } from "./delegation-rows";
import { afterFadeOut } from "./fade-out";
import { subscribe as subscribeLocale, t } from "./i18n";

/** How long a press must hold before it folds the chip. */
const FOLD_PRESS_MS = 500;

interface DelegationChipOptions {
  mount: HTMLElement;
  store: DelegationsStore;
  /** Per-device fold choice. */
  collapsed: DelegationChipSettingsStore;
  now?: () => number;
}

export interface DelegationChip {
  el: HTMLElement;
  dispose(): void;
}

export function createDelegationChip({
  mount,
  store,
  collapsed,
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
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let cancelListFade: (() => void) | null = null;
  let cancelHideFade: (() => void) | null = null;

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

  function refresh(): void {
    const items = store.get();
    const running = store.runningCount();
    if (running === 0) {
      hide();
      return;
    }
    labelEl.textContent = t("deleg.chip_running", { n: running });
    countEl.textContent = String(running);
    if (listOpen) renderDelegationRows(rowsEl, items, now());
    if (visible) return;
    visible = true;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-visible"));
    clearRefreshTimer();
    refreshTimer = setInterval(refresh, DELEGATION_REFRESH_MS);
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
    unsubscribeCollapsed();
    unsubscribeLocale();
    chipBtn.removeEventListener("pointerdown", onPointerDown);
    chipBtn.removeEventListener("pointerup", onPointerEnd);
    chipBtn.removeEventListener("pointercancel", onPointerEnd);
    chipBtn.removeEventListener("pointerleave", onPointerEnd);
    chipBtn.removeEventListener("click", onClick);
    el.remove();
  }

  return { el, dispose };
}
