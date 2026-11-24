/** Focus in a list of row buttons: the current row on demand, and a home for the focus of a row that left. */

import { type FocusEvent, type RefObject, useLayoutEffect, useRef } from "react";

const buttons = (container: HTMLElement): HTMLElement[] => [
  ...container.querySelectorAll<HTMLElement>("button"),
];

/** Focuses the row marked current, without scrolling. */
export function focusCurrentRow(container: Element | null): void {
  container?.querySelector<HTMLElement>('[aria-current="true"]')?.focus({ preventScroll: true });
}

/**
 * Tracks the focused row; once a commit removes it and focus falls to the body, focuses the row now
 * at its index, else the container. Spread the handlers on the container.
 */
export function useKeepRowFocus(container: RefObject<HTMLElement | null>): {
  onFocus(e: FocusEvent): void;
  onBlur(e: FocusEvent): void;
} {
  const row = useRef<HTMLElement | null>(null);
  const at = useRef(-1);
  useLayoutEffect(() => {
    const el = container.current;
    if (!el || !row.current) return;
    if (row.current.isConnected) {
      at.current = buttons(el).indexOf(row.current);
      return;
    }
    row.current = null;
    if (document.activeElement !== document.body) return;
    const target = buttons(el)[Math.min(at.current, buttons(el).length - 1)];
    if (target) target.focus({ preventScroll: true });
    else {
      el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
  });
  return {
    onFocus(e) {
      const el = container.current!;
      at.current = buttons(el).indexOf(e.target as HTMLElement);
      row.current = at.current < 0 ? null : (e.target as HTMLElement);
    },
    onBlur(e) {
      if (!container.current?.contains(e.relatedTarget as Node | null)) row.current = null;
    },
  };
}
