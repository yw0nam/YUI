/**
 * Hover/focus/click tooltip for elements carrying `data-tip`.
 * One floating tooltip is shared across root, so only one is ever open.
 * Hover opens after a delay (and cancels if the pointer leaves first); focus opens instantly;
 * clicking a hint dot pins it, while clicking any other target closes it.
 */

import "./hint-tooltip.css";
import { afterFadeOut } from "../fade-out";

const OPEN_DELAY_MS = 150;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

interface HintTooltipDeps {
  /** Panel root — tooltip events from every `[data-tip]` inside it are delegated here. */
  root: HTMLElement;
}

export interface HintTooltip {
  dispose(): void;
}

export function createHintTooltip(deps: HintTooltipDeps): HintTooltip {
  const { root } = deps;
  const tip = document.createElement("div");
  tip.className = "yui-hint-tip";
  tip.setAttribute("role", "tooltip");

  let openTarget: HTMLElement | null = null;
  let pinned = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelFade: (() => void) | null = null;

  function cancelPendingOpen(): void {
    if (openTimer !== null) {
      clearTimeout(openTimer);
      openTimer = null;
    }
  }

  // Below the target, centered, clamped to the viewport; flips above when there's no room below.
  function position(target: HTMLElement): void {
    const targetRect = target.getBoundingClientRect();
    tip.style.left = "0px";
    tip.style.top = "0px";
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = targetRect.left + targetRect.width / 2 - tipRect.width / 2;
    let y = targetRect.bottom + GAP;
    if (y + tipRect.height > vh - VIEWPORT_MARGIN) {
      y = targetRect.top - GAP - tipRect.height;
    }
    if (x + tipRect.width > vw - VIEWPORT_MARGIN) x = vw - VIEWPORT_MARGIN - tipRect.width;
    if (x < VIEWPORT_MARGIN) x = VIEWPORT_MARGIN;
    if (y < VIEWPORT_MARGIN) y = VIEWPORT_MARGIN;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function show(target: HTMLElement): void {
    cancelPendingOpen();
    if (openTarget && openTarget !== target) hide();
    cancelFade?.();
    cancelFade = null;
    openTarget = target;
    tip.textContent = target.dataset.tip ?? "";
    document.body.appendChild(tip);
    position(target);
    tip.classList.add("is-open");
  }

  function hide(): void {
    cancelPendingOpen();
    pinned = false;
    if (!openTarget) return;
    openTarget = null;
    tip.classList.remove("is-open");
    cancelFade = afterFadeOut(tip, () => tip.remove());
  }

  function togglePin(target: HTMLElement): void {
    if (openTarget === target && pinned) {
      hide();
      return;
    }
    show(target);
    pinned = true;
  }

  function findTarget(value: EventTarget | null): HTMLElement | null {
    if (!(value instanceof Element)) return null;
    const target = value.closest<HTMLElement>("[data-tip]");
    return target && root.contains(target) ? target : null;
  }

  function handleMouseOver(e: MouseEvent): void {
    const target = findTarget(e.target);
    if (!target || findTarget(e.relatedTarget) === target) return;
    if (pinned) return;
    cancelPendingOpen();
    openTimer = setTimeout(() => {
      openTimer = null;
      show(target);
    }, OPEN_DELAY_MS);
  }

  function handleMouseOut(e: MouseEvent): void {
    const target = findTarget(e.target);
    if (!target || findTarget(e.relatedTarget) === target) return;
    cancelPendingOpen();
    if (pinned) return;
    if (openTarget === target) hide();
  }

  function handleFocusIn(e: FocusEvent): void {
    const target = findTarget(e.target);
    if (target) show(target);
  }

  function handleFocusOut(e: FocusEvent): void {
    const target = findTarget(e.target);
    if (!target) return;
    if (pinned) return;
    if (openTarget === target) hide();
  }

  function handleClick(e: MouseEvent): void {
    const target = findTarget(e.target);
    if (!target) return;
    if (target.classList.contains("yui-hint-dot")) togglePin(target);
    else hide();
  }

  // Pinned tooltips close on any click outside the target.
  function handleDocumentClick(e: MouseEvent): void {
    if (!pinned || !openTarget) return;
    const target = e.target as Node;
    if (openTarget.contains(target)) return;
    hide();
  }

  function handleDocumentKeydown(e: KeyboardEvent): void {
    if (e.key !== "Escape" || !openTarget) return;
    const shouldConsume = openTarget.classList.contains("yui-hint-dot");
    hide();
    if (shouldConsume) e.stopPropagation();
  }

  function handleViewportChange(): void {
    if (openTarget) hide();
  }

  root.addEventListener("mouseover", handleMouseOver);
  root.addEventListener("mouseout", handleMouseOut);
  root.addEventListener("focusin", handleFocusIn);
  root.addEventListener("focusout", handleFocusOut);
  root.addEventListener("click", handleClick);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown, true);
  window.addEventListener("scroll", handleViewportChange, true);
  window.addEventListener("resize", handleViewportChange);

  function dispose(): void {
    cancelPendingOpen();
    cancelFade?.();
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleDocumentKeydown, true);
    window.removeEventListener("scroll", handleViewportChange, true);
    window.removeEventListener("resize", handleViewportChange);
    root.removeEventListener("mouseover", handleMouseOver);
    root.removeEventListener("mouseout", handleMouseOut);
    root.removeEventListener("focusin", handleFocusIn);
    root.removeEventListener("focusout", handleFocusOut);
    root.removeEventListener("click", handleClick);
    tip.remove();
  }

  return { dispose };
}
