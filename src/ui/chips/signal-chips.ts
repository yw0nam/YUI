/**
 * Signal chips — one pill per signal group beside the avatar, above the delegation chip.
 *
 * Pure renderer — firing ≠ judgment: source, label, event type and items are drawn verbatim.
 * Urgent groups each keep a row; batched ones share the newest one's row, whose "+N" unfolds the rest
 * in place. A tap opens the group's details, the cross dismisses, and a held press folds the chips with
 * the delegation chip through the shared fold store. Each row root carries `data-chip-count`.
 */

import "./signal-chips.css";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { subscribe as subscribeLocale, t } from "../i18n";
import { afterFadeOut } from "../notices/fade-out";
import { CROSS_SVG } from "../quick-controls/constants";
import { fitSheet } from "./fit-sheet";
import { holdToFold } from "./hold-to-fold";
import type { SignalChipItem, SignalChipsModel } from "./signal-chips-model";
import { renderSignalDetails } from "./signal-details";

export interface SignalChips {
  el: HTMLElement;
  dispose(): void;
}

interface Pill {
  el: HTMLElement;
  open: HTMLButtonElement;
  src: HTMLElement;
  text: HTMLElement;
  /** The grouped row's batched total, drawn in a narrow column; empty on any other pill. */
  count: HTMLElement;
  x: HTMLButtonElement;
  fold: ReturnType<typeof holdToFold>;
}

export function createSignalChips({
  mount,
  model,
  collapsed,
}: {
  mount: HTMLElement;
  model: Pick<SignalChipsModel, "list" | "subscribe" | "dismiss">;
  collapsed: DelegationChipSettingsStore;
}): SignalChips {
  const el = document.createElement("div");
  el.className = "yui-sigchips";
  el.hidden = true;
  mount.appendChild(el);

  let visible = false;
  let expanded = false;
  let openId: string | null = null;
  let cancelHide: (() => void) | null = null;
  // One pill per event id: a render updates it in place, so focus and the urgent pulse survive.
  const pills = new Map<string, Pill>();
  let details: { el: HTMLElement; item: SignalChipItem } | null = null;

  const more = document.createElement("button");
  more.type = "button";
  more.className = "yui-sigchip__more";
  more.addEventListener("click", () => {
    expanded = !expanded;
    render();
    // Expanding focuses the first revealed chip; collapsing keeps focus on "+N".
    if (expanded) region.children[1]?.querySelector<HTMLElement>(".yui-sigchip__open")?.focus();
    else more.focus();
  });
  // The expanded batched chips scroll here, apart from the urgent ones.
  const region = document.createElement("div");
  region.className = "yui-sigchips__batched";

  function setVisible(next: boolean): void {
    if (visible === next) return;
    visible = next;
    cancelHide?.();
    if (next) {
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add("is-visible"));
      return;
    }
    el.classList.remove("is-visible");
    cancelHide = afterFadeOut(el, () => {
      if (!visible) el.hidden = true;
    });
  }

  function createPill(eventId: string): Pill {
    const pill = document.createElement("div");
    pill.innerHTML = `
      <button type="button" class="yui-sigchip__open">
        <span class="yui-sigchip__dot" aria-hidden="true"></span>
        <b class="yui-sigchip__src"></b>
        <span class="yui-sigchip__text"></span>
        <span class="yui-sigchip__count" aria-hidden="true"></span>
      </button>
      <button type="button" class="yui-sigchip__x">${CROSS_SVG}</button>
    `;
    const made: Pill = {
      el: pill,
      open: pill.querySelector(".yui-sigchip__open")!,
      src: pill.querySelector(".yui-sigchip__src")!,
      text: pill.querySelector(".yui-sigchip__text")!,
      count: pill.querySelector(".yui-sigchip__count")!,
      x: pill.querySelector(".yui-sigchip__x")!,
      fold: holdToFold(pill, collapsed),
    };
    made.open.addEventListener("click", () => {
      openId = openId === eventId ? null : eventId;
      render();
      if (openId !== null) focusIn(".yui-sigdetails__close");
    });
    made.x.addEventListener("click", () => model.dismiss(eventId));
    // Capture, so a swallowed click never reaches the buttons.
    pill.addEventListener(
      "click",
      (e) => {
        if (made.fold.swallowClick()) {
          e.stopPropagation();
        } else if (collapsed.get().collapsed) {
          e.stopPropagation();
          collapsed.setCollapsed(false);
        }
      },
      true,
    );
    return made;
  }

  function updatePill(pill: Pill, item: SignalChipItem): void {
    const { source, label, event_type, event_id } = item.group.envelope;
    const text = label ?? event_type;
    pill.el.className = `yui-sigchip yui-sigchip--${item.delivery}`;
    pill.el.toggleAttribute("data-chip-urgent", item.delivery === "urgent");
    pill.x.hidden = false;
    pill.count.textContent = "";
    pill.src.textContent = source;
    pill.text.textContent = text;
    pill.open.setAttribute("aria-expanded", String(openId === event_id));
    pill.open.setAttribute(
      "aria-label",
      t("sigchip.chip_aria", { delivery: t(`signals.delivery_${item.delivery}`), source, text }),
    );
    pill.x.setAttribute("aria-label", t("sigchip.dismiss"));
  }

  function focusIn(selector: string): void {
    el.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  /** Puts `node` at `index` among `parent`'s children, moving it only when it is elsewhere. */
  function place(node: HTMLElement, index: number, parent: HTMLElement = el): void {
    if (parent.children[index] !== node) parent.insertBefore(node, parent.children[index] ?? null);
  }

  function closeDetails(): void {
    const id = openId;
    openId = null;
    render();
    if (id !== null) pills.get(id)?.open.focus({ preventScroll: true });
  }

  function render(): void {
    const items = model.list();
    if (items.length === 0) {
      openId = null;
      expanded = false;
      renderDetails(undefined, 0);
      setVisible(false);
      return;
    }
    const urgent = items.filter((i) => i.delivery === "urgent");
    const batched = items.filter((i) => i.delivery !== "urgent");
    if (batched.length < 2) expanded = false;
    const shownBatched = expanded ? batched : batched.slice(0, 1);
    const opened = items.find((i) => i.group.envelope.event_id === openId);
    if (!opened) openId = null;

    const shownIds = new Set([...urgent, ...shownBatched].map((i) => i.group.envelope.event_id));
    for (const [id, pill] of pills) {
      if (shownIds.has(id)) continue;
      pill.fold.dispose();
      pill.el.remove();
      pills.delete(id);
    }
    const pillOf = (item: SignalChipItem): Pill => {
      const id = item.group.envelope.event_id;
      let pill = pills.get(id);
      if (!pill) pills.set(id, (pill = createPill(id)));
      updatePill(pill, item);
      return pill;
    };
    urgent.forEach((item, index) => {
      const { el: row } = pillOf(item);
      row.dataset.chipCount = "1";
      place(row, index);
    });

    const hiddenCount = batched.length - 1;
    more.textContent = expanded ? t("sigchip.collapse") : t("sigchip.more", { n: hiddenCount });
    more.setAttribute(
      "aria-label",
      expanded ? t("sigchip.collapse") : t("sigchip.more_aria", { n: hiddenCount }),
    );
    more.setAttribute("aria-expanded", String(expanded));
    let rows = urgent.length;
    if (expanded) {
      // The region is the row: its chips carry no count of their own.
      shownBatched.forEach((item, index) => {
        const { el: chip } = pillOf(item);
        delete chip.dataset.chipCount;
        place(chip, index, region);
      });
      place(more, shownBatched.length, region);
      region.dataset.chipCount = String(batched.length);
      place(region, rows++);
    } else {
      region.remove();
      const [newest] = shownBatched;
      if (newest) {
        const pill = pillOf(newest);
        pill.el.dataset.chipCount = String(batched.length);
        place(pill.el, rows++);
        if (hiddenCount > 0) {
          pill.x.hidden = true;
          pill.count.textContent = String(batched.length);
          if (more.parentNode !== pill.el) pill.el.append(more);
        }
      }
      if (hiddenCount === 0) more.remove();
    }

    renderDetails(opened && !collapsed.get().collapsed ? opened : undefined, rows);
    setVisible(true);
    if (details) fitSheet(details.el);
  }

  // The sheet is rebuilt only when what it shows changed, so focus inside it survives.
  function renderDetails(item: SignalChipItem | undefined, shownCount: number): void {
    if (!item) {
      details?.el.remove();
      details = null;
      return;
    }
    const stale = details?.item.said !== item.said || details?.item.group !== item.group;
    if (!details || stale) {
      const hadFocus = details?.el.contains(document.activeElement) ?? false;
      details?.el.remove();
      const id = item.group.envelope.event_id;
      details = {
        el: renderSignalDetails(item, {
          onClose: closeDetails,
          onDismiss: () => {
            model.dismiss(id);
            focusIn(".yui-sigchip__open");
          },
        }),
        item,
      };
      if (hadFocus)
        details.el
          .querySelector<HTMLElement>(".yui-sigdetails__close")
          ?.focus({ preventScroll: true });
    }
    place(details.el, shownCount);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && openId !== null) closeDetails();
  }
  document.addEventListener("keydown", onKeydown);

  // The column's height and the window size move the sheet's anchor.
  const resizes = new ResizeObserver(() => {
    if (details) fitSheet(details.el);
  });
  resizes.observe(mount);
  resizes.observe(document.documentElement);

  function applyCollapsed(isFolded: boolean): void {
    el.classList.toggle("is-mini", isFolded);
    if (isFolded) openId = null;
    render();
  }

  const offModel = model.subscribe(render);
  const offCollapsed = collapsed.subscribe((s) => applyCollapsed(s.collapsed));
  const offLocale = subscribeLocale(render);
  applyCollapsed(collapsed.get().collapsed);

  return {
    el,
    dispose(): void {
      for (const pill of pills.values()) pill.fold.dispose();
      cancelHide?.();
      document.removeEventListener("keydown", onKeydown);
      resizes.disconnect();
      offModel();
      offCollapsed();
      offLocale();
      el.remove();
    },
  };
}
