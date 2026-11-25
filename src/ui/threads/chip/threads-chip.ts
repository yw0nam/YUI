/**
 * Threads chip — the pill in main's chip column that counts waiting Threads the user has not picked,
 * and access requests, and opens the Threads window. Pure renderer: the marks, label, and count come from the snapshots;
 * hidden while nothing waits or the window is open; one wiggle when a Thread or a request starts
 * waiting outside do-not-disturb; a held press folds it with the other chips.
 */

import "./threads-chip.css";
import type { AccessRequest, ScreenRect, Thread } from "../../../contract";
import { isWaiting } from "../../../io/threads/threads-waiting";
import type { DelegationChipSettingsStore } from "../../../settings/panels/delegation-chip-settings";
import { holdToFold } from "../../chips/hold-to-fold";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { CAPPED } from "../../surfaces/chip-column";
import { threadSource } from "../thread-source";

const MAX_MARKS = 3;

export interface ThreadsChip {
  el: HTMLButtonElement;
  update(threads: Thread[]): void;
  /** The terminal store's pending access requests, counted as waiting. */
  updateRequests(requests: AccessRequest[]): void;
  /** Whether the window is open; the chip hides while it is. */
  setWindowOpen(open: boolean): void;
  /** The chip's rect in this window's viewport: where it is shown, or the slot it would take while hidden or capped. */
  slotRect(): ScreenRect;
  dispose(): void;
}

export function createThreadsChip({
  mount,
  collapsed,
  onOpen,
  isDndOn,
}: {
  mount: HTMLElement;
  collapsed: DelegationChipSettingsStore;
  /** The chip's rect in this window's viewport. */
  onOpen(chip: ScreenRect): void;
  /** Whether do-not-disturb is on: an arrival then never wiggles. */
  isDndOn: () => boolean;
}): ThreadsChip {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "yui-threadchip";
  el.hidden = true;
  el.innerHTML = `
    <span class="yui-threadchip__marks" aria-hidden="true"></span>
    <span class="yui-threadchip__label"></span>
    <span class="yui-threadchip__count" aria-hidden="true"></span>
  `;
  mount.appendChild(el);
  const marksEl = el.querySelector<HTMLElement>(".yui-threadchip__marks")!;
  const labelEl = el.querySelector<HTMLElement>(".yui-threadchip__label")!;
  const countEl = el.querySelector<HTMLElement>(".yui-threadchip__count")!;

  let waiting: Thread[] = [];
  const keys = { thread: [] as string[], request: [] as string[] };
  let waitingIds: Set<string> | null = null;
  let windowOpen = false;

  function wiggle(): void {
    el.classList.remove("is-wiggle");
    // A reflow restarts the animation when a wiggle lands mid-wiggle.
    void el.offsetWidth;
    el.classList.add("is-wiggle");
  }

  function render(): void {
    const sources = [...new Set(waiting.map((th) => th.source))].slice(0, MAX_MARKS);
    marksEl.replaceChildren(
      ...sources.map((source) => {
        const mark = document.createElement("span");
        mark.className = "yui-threadchip__mark";
        const { name, mark: glyph } = threadSource(source);
        mark.textContent = glyph;
        mark.title = name;
        return mark;
      }),
    );
    const n = waiting.length + keys.request.length;
    labelEl.textContent = t("threads.chip_label");
    countEl.textContent = String(n);
    el.setAttribute("aria-label", t("threads.chip_aria", { n }));
    el.dataset.chipCount = String(n);
    el.hidden = n === 0 || windowOpen;
  }

  // The first snapshot sets what already waits; only a later arrival wiggles.
  function track(kind: keyof typeof keys, ids: string[]): void {
    const before = waitingIds;
    keys[kind] = ids.map((id) => `${kind}:${id}`);
    const arrived = before !== null && keys[kind].some((key) => !before.has(key));
    waitingIds = new Set([...keys.thread, ...keys.request]);
    render();
    if (arrived && !el.hidden && !isDndOn()) wiggle();
  }

  const rect = (): ScreenRect => {
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  };

  const fold = holdToFold(el, collapsed);
  function onClick(): void {
    if (fold.swallowClick()) return;
    if (collapsed.get().collapsed) {
      collapsed.setCollapsed(false);
      return;
    }
    onOpen(rect());
  }
  const onAnimationEnd = (): void => el.classList.remove("is-wiggle");
  el.addEventListener("click", onClick);
  el.addEventListener("animationend", onAnimationEnd);
  const offCollapsed = collapsed.subscribe((s) => el.classList.toggle("is-mini", s.collapsed));
  el.classList.toggle("is-mini", collapsed.get().collapsed);
  const offLocale = subscribeLocale(render);

  return {
    el,
    update(threads) {
      waiting = threads.filter(isWaiting).sort((a, b) => b.updated_at - a.updated_at);
      track(
        "thread",
        waiting.map((th) => th.id),
      );
    },
    updateRequests(requests) {
      track(
        "request",
        requests.map((r) => r.id),
      );
    },
    setWindowOpen(open) {
      windowOpen = open;
      render();
    },
    slotRect() {
      const { hidden } = el;
      const capped = el.classList.contains(CAPPED);
      if (!hidden && !capped) return rect();
      // Laid out but invisible for one synchronous read; nothing paints before it is put back.
      el.hidden = false;
      el.classList.remove(CAPPED);
      el.classList.add("is-measuring");
      const slot = rect();
      el.classList.remove("is-measuring");
      el.classList.toggle(CAPPED, capped);
      el.hidden = hidden;
      return slot;
    },
    dispose() {
      fold.dispose();
      offCollapsed();
      offLocale();
      el.removeEventListener("click", onClick);
      el.removeEventListener("animationend", onAnimationEnd);
      el.remove();
    },
  };
}
