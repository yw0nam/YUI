/**
 * Signal chips — one pill per signal group beside the avatar, above the delegation chip.
 *
 * Pure renderer — firing ≠ judgment: source, label, event type and items are drawn verbatim.
 * A tap opens the group's card, the cross dismisses, "+N" unfolds the rest in place, and a
 * held press folds the chips with the delegation chip through the shared fold store.
 */

import "./signal-chips.css";
import type { DelegationChipSettingsStore } from "../../settings/panels/delegation-chip-settings";
import { subscribe as subscribeLocale, t } from "../i18n";
import { afterFadeOut } from "../notices/fade-out";
import { FOLD_PRESS_MS } from "./delegation-chip";
import { renderSignalCard } from "./signal-card";
import type { SignalChipItem, SignalChipsModel } from "./signal-chips-model";

const SHOWN_FOLDED = 3;
const CROSS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>`;

export interface SignalChips {
  el: HTMLElement;
  dispose(): void;
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

  // A press held past FOLD_PRESS_MS folds; the release's click is swallowed.
  let foldTimer: ReturnType<typeof setTimeout> | null = null;
  let heldFold = false;

  function clearFold(): void {
    if (foldTimer !== null) clearTimeout(foldTimer);
    foldTimer = null;
  }

  function pillOf(item: SignalChipItem): HTMLElement {
    const { source, label, event_type, event_id } = item.group.envelope;
    const text = label ?? event_type;
    const pill = document.createElement("div");
    pill.className = `yui-sigchip yui-sigchip--${item.delivery}`;
    pill.innerHTML = `
      <button type="button" class="yui-sigchip__open">
        <span class="yui-sigchip__dot" aria-hidden="true"></span>
        <b class="yui-sigchip__src"></b>
        <span class="yui-sigchip__text"></span>
      </button>
      <button type="button" class="yui-sigchip__x">${CROSS_SVG}</button>
    `;
    const open = pill.querySelector<HTMLButtonElement>(".yui-sigchip__open")!;
    pill.querySelector(".yui-sigchip__src")!.textContent = source;
    pill.querySelector(".yui-sigchip__text")!.textContent = text;
    open.setAttribute("aria-expanded", String(openId === event_id));
    open.setAttribute(
      "aria-label",
      t("sigchip.chip_aria", { delivery: t(`signals.delivery_${item.delivery}`), source, text }),
    );
    open.addEventListener("click", () => {
      openId = openId === event_id ? null : event_id;
      render();
    });
    const x = pill.querySelector<HTMLButtonElement>(".yui-sigchip__x")!;
    x.setAttribute("aria-label", t("sigchip.dismiss"));
    x.addEventListener("click", () => model.dismiss(event_id));

    pill.addEventListener("pointerdown", () => {
      clearFold();
      heldFold = false;
      foldTimer = setTimeout(() => {
        foldTimer = null;
        heldFold = true;
        collapsed.setCollapsed(true);
      }, FOLD_PRESS_MS);
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
      pill.addEventListener(type, clearFold);
    }
    // Capture, so a swallowed click never reaches the buttons.
    pill.addEventListener(
      "click",
      (e) => {
        if (!heldFold && !collapsed.get().collapsed) return;
        e.stopPropagation();
        if (!heldFold) collapsed.setCollapsed(false);
        heldFold = false;
      },
      true,
    );
    return pill;
  }

  // "+N" and "Collapse" both flip the in-place expansion.
  function toggleButton(className: string, text: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = text;
    btn.addEventListener("click", () => {
      expanded = !expanded;
      render();
    });
    return btn;
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
    el.replaceChildren(...shown.map(pillOf));
    if (items.length > SHOWN_FOLDED) {
      el.append(
        expanded
          ? toggleButton("yui-sigchip__collapse", t("sigchip.collapse"))
          : toggleButton(
              "yui-sigchip__more",
              t("sigchip.more", { n: items.length - SHOWN_FOLDED }),
            ),
      );
    }
    if (opened && !collapsed.get().collapsed) {
      const id = opened.group.envelope.event_id;
      el.append(
        renderSignalCard(opened, {
          onClose: () => {
            openId = null;
            render();
          },
          onDismiss: () => model.dismiss(id),
        }),
      );
    }
    setVisible(true);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || openId === null) return;
    openId = null;
    render();
  }
  document.addEventListener("keydown", onKeydown);

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
      clearFold();
      cancelHide?.();
      document.removeEventListener("keydown", onKeydown);
      offModel();
      offCollapsed();
      offLocale();
      el.remove();
    },
  };
}
