/**
 * Signal chips — one pill per signal group beside the avatar, above the delegation chip.
 *
 * Pure renderer — firing ≠ judgment: source, label, event type and items are drawn verbatim.
 * A tap opens the group's details, the cross dismisses, "+N" unfolds the rest in place, and a
 * held press folds the chips with the delegation chip through the shared fold store.
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

const SHOWN_FOLDED = 3;

export interface SignalChips {
  el: HTMLElement;
  dispose(): void;
}

interface Pill {
  el: HTMLElement;
  open: HTMLButtonElement;
  src: HTMLElement;
  text: HTMLElement;
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
  });

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
      </button>
      <button type="button" class="yui-sigchip__x">${CROSS_SVG}</button>
    `;
    const made: Pill = {
      el: pill,
      open: pill.querySelector(".yui-sigchip__open")!,
      src: pill.querySelector(".yui-sigchip__src")!,
      text: pill.querySelector(".yui-sigchip__text")!,
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

  /** Puts `node` at `index` among the container's children, moving it only when it is elsewhere. */
  function place(node: HTMLElement, index: number): void {
    if (el.children[index] !== node) el.insertBefore(node, el.children[index] ?? null);
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
      setVisible(false);
      return;
    }
    if (items.length <= SHOWN_FOLDED) expanded = false;
    const shown = expanded ? items : items.slice(0, SHOWN_FOLDED);
    const opened = items.find((i) => i.group.envelope.event_id === openId);
    if (!opened) openId = null;
    el.classList.toggle("is-expanded", expanded);

    const shownIds = new Set(shown.map((i) => i.group.envelope.event_id));
    for (const [id, pill] of pills) {
      if (shownIds.has(id)) continue;
      pill.fold.dispose();
      pill.el.remove();
      pills.delete(id);
    }
    shown.forEach((item, index) => {
      const id = item.group.envelope.event_id;
      let pill = pills.get(id);
      if (!pill) pills.set(id, (pill = createPill(id)));
      updatePill(pill, item);
      place(pill.el, index);
    });

    if (items.length > SHOWN_FOLDED) {
      more.textContent = expanded
        ? t("sigchip.collapse")
        : t("sigchip.more", { n: items.length - SHOWN_FOLDED });
      more.setAttribute(
        "aria-label",
        expanded
          ? t("sigchip.collapse")
          : t("sigchip.more_aria", { n: items.length - SHOWN_FOLDED }),
      );
      more.setAttribute("aria-expanded", String(expanded));
      place(more, shown.length);
    } else {
      more.remove();
    }

    renderDetails(opened && !collapsed.get().collapsed ? opened : undefined, shown.length);
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
    place(details.el, shownCount + (more.parentNode === el ? 1 : 0));
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
