/** Hold-to-fold — a press held past FOLD_PRESS_MS folds the chips; the release's click is swallowed. */

/** How long a press must hold before it folds. */
const FOLD_PRESS_MS = 500;

export function holdToFold(
  el: HTMLElement,
  collapsed: { setCollapsed(collapsed: boolean): void },
): {
  /** True once for the click that ends a fold hold. */
  swallowClick(): boolean;
  dispose(): void;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let folded = false;

  function clear(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function onPointerDown(): void {
    clear();
    folded = false;
    timer = setTimeout(() => {
      timer = null;
      folded = true;
      collapsed.setCollapsed(true);
    }, FOLD_PRESS_MS);
  }

  const ends = ["pointerup", "pointercancel", "pointerleave"] as const;
  el.addEventListener("pointerdown", onPointerDown);
  for (const type of ends) el.addEventListener(type, clear);

  return {
    swallowClick(): boolean {
      const swallow = folded;
      folded = false;
      return swallow;
    },
    dispose(): void {
      clear();
      el.removeEventListener("pointerdown", onPointerDown);
      for (const type of ends) el.removeEventListener(type, clear);
    },
  };
}
