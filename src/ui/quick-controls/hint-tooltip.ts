/**
 * Hover/focus/click tooltip for the `.yui-hint-dot` `?` markers.
 * One floating tooltip is shared across every dot in root, so only one is ever open.
 * Hover opens after a delay (and cancels if the pointer leaves first); focus opens instantly;
 * click pins it open until the same dot, an outside click, or Escape closes it.
 */

import "./hint-tooltip.css";
import { afterFadeOut } from "../fade-out";

const OPEN_DELAY_MS = 150;
const VIEWPORT_MARGIN = 8;
const GAP = 6;

interface HintTooltipDeps {
  /** Panel root — every `.yui-hint-dot` inside it gets hover/focus/click wiring. */
  root: HTMLElement;
}

export interface HintTooltip {
  dispose(): void;
}

export function createHintTooltip(deps: HintTooltipDeps): HintTooltip {
  const { root } = deps;
  const dots = Array.from(root.querySelectorAll<HTMLElement>(".yui-hint-dot"));

  const tip = document.createElement("div");
  tip.className = "yui-hint-tip";
  tip.setAttribute("role", "tooltip");

  let openDot: HTMLElement | null = null;
  let pinned = false;
  let openTimer: ReturnType<typeof setTimeout> | null = null;
  let cancelFade: (() => void) | null = null;

  function cancelPendingOpen(): void {
    if (openTimer !== null) {
      clearTimeout(openTimer);
      openTimer = null;
    }
  }

  // Below the dot, centered, clamped to the viewport; flips above when there's no room below.
  function position(dot: HTMLElement): void {
    const dotRect = dot.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = dotRect.left + dotRect.width / 2 - tipRect.width / 2;
    let y = dotRect.bottom + GAP;
    if (y + tipRect.height > vh - VIEWPORT_MARGIN) y = dotRect.top - GAP - tipRect.height;
    if (x + tipRect.width > vw - VIEWPORT_MARGIN) x = vw - VIEWPORT_MARGIN - tipRect.width;
    if (x < VIEWPORT_MARGIN) x = VIEWPORT_MARGIN;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }

  function show(dot: HTMLElement): void {
    cancelPendingOpen();
    cancelFade?.();
    cancelFade = null;
    if (openDot && openDot !== dot) hide();
    openDot = dot;
    tip.textContent = dot.getAttribute("aria-label") ?? "";
    document.body.appendChild(tip);
    position(dot);
    tip.classList.add("is-open");
  }

  function hide(): void {
    cancelPendingOpen();
    pinned = false;
    if (!openDot) return;
    openDot = null;
    tip.classList.remove("is-open");
    cancelFade = afterFadeOut(tip, () => tip.remove());
  }

  function togglePin(dot: HTMLElement): void {
    if (openDot === dot && pinned) {
      hide();
      return;
    }
    show(dot);
    pinned = true;
  }

  function handleMouseEnter(e: MouseEvent): void {
    const dot = e.currentTarget as HTMLElement;
    if (pinned) return;
    cancelPendingOpen();
    openTimer = setTimeout(() => {
      openTimer = null;
      show(dot);
    }, OPEN_DELAY_MS);
  }

  function handleMouseLeave(e: MouseEvent): void {
    const dot = e.currentTarget as HTMLElement;
    cancelPendingOpen();
    if (pinned) return;
    if (openDot === dot) hide();
  }

  function handleFocus(e: FocusEvent): void {
    show(e.currentTarget as HTMLElement);
  }

  function handleBlur(e: FocusEvent): void {
    const dot = e.currentTarget as HTMLElement;
    if (pinned) return;
    if (openDot === dot) hide();
  }

  function handleClick(e: MouseEvent): void {
    togglePin(e.currentTarget as HTMLElement);
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    togglePin(e.currentTarget as HTMLElement);
  }

  // Pinned tooltips close on any click outside the dot and the tooltip itself.
  function handleDocumentClick(e: MouseEvent): void {
    if (!pinned || !openDot) return;
    const target = e.target as Node;
    if (openDot.contains(target) || tip.contains(target)) return;
    hide();
  }

  function handleDocumentKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape" && openDot) hide();
  }

  for (const dot of dots) {
    dot.addEventListener("mouseenter", handleMouseEnter);
    dot.addEventListener("mouseleave", handleMouseLeave);
    dot.addEventListener("focus", handleFocus);
    dot.addEventListener("blur", handleBlur);
    dot.addEventListener("click", handleClick);
    dot.addEventListener("keydown", handleKeydown);
  }
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleDocumentKeydown);

  function dispose(): void {
    cancelPendingOpen();
    cancelFade?.();
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleDocumentKeydown);
    for (const dot of dots) {
      dot.removeEventListener("mouseenter", handleMouseEnter);
      dot.removeEventListener("mouseleave", handleMouseLeave);
      dot.removeEventListener("focus", handleFocus);
      dot.removeEventListener("blur", handleBlur);
      dot.removeEventListener("click", handleClick);
      dot.removeEventListener("keydown", handleKeydown);
    }
    tip.remove();
  }

  return { dispose };
}
