/**
 * Delegation chip — the push transport's one status surface beside the avatar.
 *
 * Pure renderer — firing ≠ judgment: this only *draws* the delegations list the push socket
 * feeds and the state that socket reports. While the socket is ready it carries the running
 * count and its tap toggles the list popover; while it is connecting, reconnecting or failed
 * it names that state in the Connection tab's words, and its tap opens the settings panel's
 * Connection tab, which holds the reconnect action; while it is disconnected — no transport in
 * use — it draws nothing.
 * A held press folds the chip to its dot, and the fold is a per-device choice.
 */

import "./delegation-chip.css";
import type { DelegationItem } from "../../io/chat/push/push-frames";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { subscribe as subscribeLocale, t } from "../i18n";
import { afterFadeOut } from "../notices/fade-out";
import { DELEGATION_REFRESH_MS, renderDelegationRows } from "./delegation-rows";
import { holdToFold } from "./hold-to-fold";

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
  /**
   * The transport the chip reports on: disconnected draws nothing; connecting, reconnecting and
   * failed read as a lost connection.
   */
  pushState: PushStatePort;
  /** Opens the settings panel's Connection tab — what a tap does while the connection is lost. */
  onOpenSettings: () => void;
  /** Starts hidden, for a window that has nothing to report yet. */
  suppressed?: boolean;
  now?: () => number;
}

export interface DelegationChip {
  el: HTMLElement;
  /** Hides the chip entirely — the popped-out surfaces carry it instead. */
  setSuppressed(suppressed: boolean): void;
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

  function show(): void {
    if (visible) return;
    visible = true;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add("is-visible"));
  }

  /** The Connection tab's wording for a live loss, so the chip and the tab name one cause. */
  function lostLabel(state: PushSocketState): string {
    switch (state.kind) {
      case "reconnecting":
        return t("svc.chat_status_reconnecting", { seconds: Math.ceil(state.delay_ms / 1000) });
      case "failed":
        return t("svc.chat_status_refused");
      default:
        return t("svc.chat_status_connecting");
    }
  }

  function refresh(): void {
    const kind = pushState.getState().kind;
    // disconnected means no transport is in use — nothing was asked to be up, so nothing is lost.
    if (kind === "disconnected") {
      el.classList.remove("is-lost");
      hide();
      return;
    }
    // Every live loss shows the red dot; the label names which loss.
    const lost = kind !== "ready";
    el.classList.toggle("is-lost", lost);
    if (suppressed) {
      hide();
      return;
    }
    if (lost) {
      clearRefreshTimer();
      closeList();
      chipBtn.removeAttribute("aria-expanded");
      labelEl.textContent = lostLabel(pushState.getState());
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

  const fold = holdToFold(chipBtn, collapsed);

  function onClick(): void {
    if (fold.swallowClick()) return;
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
    document.removeEventListener("keydown", onListKeydown);
    cancelListFade?.();
    cancelHideFade?.();
    unsubscribeStore();
    unsubscribePushState();
    unsubscribeCollapsed();
    unsubscribeLocale();
    fold.dispose();
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
    dispose,
  };
}
