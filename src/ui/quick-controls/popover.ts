/**
 * Popover shell — positioning, dragging, and the open/close lifecycle of the
 * right-click summon panel.
 * variant="popover" docks inside the pet window (drag, scrim, viewport clamp),
 * variant="window" fills the OS window (no drag/scrim/animation, always shown).
 * Content refresh (reflect/render/monitor) is delegated to the onOpen callback;
 * gain/audition/key-commit cleanup is delegated to the onClose callback.
 */

import { localStorageStore } from "../../io/persisted-store";

const VIEWPORT_MARGIN = 12;
const POS_KEY = "yui.quick.pos";

interface SavedPos {
  x: number;
  y: number;
}

const posStore = localStorageStore<SavedPos>(POS_KEY);

function loadSavedPos(): SavedPos | null {
  const parsed = posStore.load();
  if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number") return null;
  if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
  return { x: parsed.x, y: parsed.y };
}

function savePos(pos: SavedPos): void {
  posStore.save(pos);
}

export interface PopoverDeps {
  /** Mount container the scrim and panel attach to. */
  mount: HTMLElement;
  /** Panel root node (el). */
  root: HTMLElement;
  /** Outside-click detection scrim (popover variant only). */
  scrim: HTMLElement;
  /** Drag handle bar — absent (null) in the window variant. */
  bar: HTMLElement | null;
  /** When true (window variant), fill the OS window with no drag/scrim/animation. */
  isWindow: boolean;
  /** Window variant only — injected by the host when Escape must close the OS window. Without it, Escape is a no-op. */
  closeWindow?: () => void;
  /** Refresh content on open (reflect/render/monitor load). Called before positioning so dimensions are settled. */
  onOpen: () => void;
  /** Cleanup on close (gain preview, audition, key commit). Called before openState=false. */
  onClose: () => void;
}

export interface Popover {
  open(anchor?: { x: number; y: number }): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createPopover(deps: PopoverDeps): Popover {
  const { mount, root, scrim, bar, isWindow, closeWindow, onOpen, onClose } = deps;

  let openState = false;
  let closeRafId: number | null = null;
  // In the popover variant, remember focus just before open and restore it on close.
  let prevFocus: HTMLElement | null = null;

  const FOCUSABLE_SEL = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

  function focusables(): HTMLElement[] {
    // Exclude controls in [hidden] subtrees (e.g. inactive tab panels) so the trap doesn't leak to an invisible end.
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SEL)).filter(
      (el) => !(el as HTMLButtonElement).disabled && !el.closest("[hidden]"),
    );
  }

  function focusFirst(): void {
    focusables()[0]?.focus();
  }

  // ── Positioning (popover variant) ──

  function clampToViewport(x: number, y: number): { x: number; y: number } {
    const rect = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (nx + rect.width > vw - VIEWPORT_MARGIN) nx = vw - VIEWPORT_MARGIN - rect.width;
    if (nx < VIEWPORT_MARGIN) nx = VIEWPORT_MARGIN;
    if (ny + rect.height > vh - VIEWPORT_MARGIN) ny = vh - VIEWPORT_MARGIN - rect.height;
    if (ny < VIEWPORT_MARGIN) ny = VIEWPORT_MARGIN;
    return { x: nx, y: ny };
  }

  function placeAt(x: number, y: number): void {
    root.style.removeProperty("bottom");
    root.style.transform = "";
    const c = clampToViewport(x, y);
    root.style.left = `${c.x}px`;
    root.style.top = `${c.y}px`;
  }

  function placeFallback(): void {
    root.style.removeProperty("left");
    root.style.removeProperty("top");
    root.style.left = "50%";
    root.style.bottom = "9%";
    root.style.transform = "translate(-50%, 0)";
  }

  function positionPopover(anchor?: { x: number; y: number }): void {
    // Priority: saved position > cursor anchor > bottom-center fallback.
    const saved = loadSavedPos();
    if (saved) {
      placeAt(saved.x, saved.y);
      return;
    }
    if (anchor) {
      // Open below the anchor, but flip above it when there's no room below (preserving existing behavior).
      const rect = root.getBoundingClientRect();
      const vh = window.innerHeight;
      let y = anchor.y;
      if (y + rect.height > vh - VIEWPORT_MARGIN) y = anchor.y - rect.height;
      placeAt(anchor.x, y);
      return;
    }
    placeFallback();
  }

  // ── Drag (popover variant) ──

  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOriginLeft = 0;
  let dragOriginTop = 0;

  function handleBarPointerDown(e: PointerEvent): void {
    if (isWindow) return;
    if (e.button !== 0) return;
    // Clicks on the header buttons (pop-out, close) aren't treated as a drag.
    if ((e.target as HTMLElement).closest(".yui-iconbtn")) return;
    dragging = true;
    // While docked we drive left/top numerically, so use those values as the origin.
    // (Fall back to the layout rect only when the style is unset.)
    const styleLeft = parseFloat(root.style.left);
    const styleTop = parseFloat(root.style.top);
    if (Number.isFinite(styleLeft) && Number.isFinite(styleTop)) {
      dragOriginLeft = styleLeft;
      dragOriginTop = styleTop;
    } else {
      const rect = root.getBoundingClientRect();
      dragOriginLeft = rect.left;
      dragOriginTop = rect.top;
    }
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    bar?.classList.add("is-dragging");
    document.addEventListener("pointermove", handleDocPointerMove);
    document.addEventListener("pointerup", handleDocPointerUp);
  }

  function handleDocPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    placeAt(dragOriginLeft + dx, dragOriginTop + dy);
  }

  function handleDocPointerUp(): void {
    if (!dragging) return;
    dragging = false;
    bar?.classList.remove("is-dragging");
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
    const x = parseFloat(root.style.left);
    const y = parseFloat(root.style.top);
    if (Number.isFinite(x) && Number.isFinite(y)) savePos({ x, y });
  }

  // ── open / close ──

  function open(anchor?: { x: number; y: number }): void {
    if (openState) return;
    openState = true;

    if (closeRafId !== null) {
      cancelAnimationFrame(closeRafId);
      closeRafId = null;
    }

    if (!isWindow) mount.appendChild(scrim);
    mount.appendChild(root);

    // The host injects content refresh (reflect/render/monitor) via onOpen — run it before positioning to settle dimensions.
    onOpen();

    if (isWindow) {
      // The window variant fills the OS window — no positioning or animation.
      root.classList.add("is-open");
    } else {
      positionPopover(anchor);
    }

    if (!isWindow) {
      requestAnimationFrame(() => {
        root.classList.add("is-open");
      });
    }

    // Remember focus just before opening (restored in the popover variant only) and move to the first control.
    prevFocus = isWindow ? null : (document.activeElement as HTMLElement | null);
    focusFirst();
  }

  function close(): void {
    if (!openState) return;
    onClose();
    openState = false;

    if (isWindow) {
      // The window variant is always visible, so don't detach it from the DOM.
      return;
    }

    root.classList.remove("is-open");

    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      root.removeEventListener("transitionend", onEnd);
      if (!root.classList.contains("is-open")) {
        root.remove();
        scrim.remove();
      }
    };
    root.addEventListener("transitionend", onEnd);

    closeRafId = requestAnimationFrame(() => {
      closeRafId = null;
      if (!openState && !root.classList.contains("is-open")) {
        root.remove();
        scrim.remove();
      }
    });

    // Restore focus to the pre-open element (only if it's still in the document).
    if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
    prevFocus = null;
  }

  function isOpen(): boolean {
    return openState;
  }

  function handleScrimPointerDown(e: PointerEvent): void {
    e.stopPropagation();
    close();
  }

  function handleDocKeydown(e: KeyboardEvent): void {
    if (!openState) return;
    if (e.key === "Escape") {
      if (isWindow) {
        // In the window variant, internal close() doesn't remove the panel (always shown) — closing the OS window is the host's job.
        if (!closeWindow) return;
        e.preventDefault();
        close(); // Run cleanup (key commit, audition abort) first.
        closeWindow();
        return;
      }
      e.preventDefault();
      close();
      return;
    }
    // Popover variant focus trap — when Tab leaves the root, wrap to the opposite end.
    if (e.key === "Tab" && !isWindow) {
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (!active || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  scrim.addEventListener("pointerdown", handleScrimPointerDown);
  document.addEventListener("keydown", handleDocKeydown);
  bar?.addEventListener("pointerdown", handleBarPointerDown);

  function dispose(): void {
    scrim.removeEventListener("pointerdown", handleScrimPointerDown);
    document.removeEventListener("keydown", handleDocKeydown);
    bar?.removeEventListener("pointerdown", handleBarPointerDown);
    document.removeEventListener("pointermove", handleDocPointerMove);
    document.removeEventListener("pointerup", handleDocPointerUp);
  }

  return { open, close, isOpen, dispose };
}
