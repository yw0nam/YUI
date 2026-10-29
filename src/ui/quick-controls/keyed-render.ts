/**
 * Keyed re-render: replaces a root's markup and keeps what a reader would see move. Focus stays
 * on the control with the same `data-fk`, a `data-k` block new since the last render fades in,
 * and a switch with a `data-fk` slides from the state it showed before.
 */

import "./keyed-render.css";

/** Renders `markup()` into `root`; `focusKey` focuses that control instead of the focused one. */
export function createKeyedRender(
  root: HTMLElement,
  markup: () => string,
): (focusKey?: string) => void {
  const seen = new Set<string>();
  const switches = new Map<string, string>();
  let rendered = false;

  return (focusKey) => {
    const active = document.activeElement;
    const focus =
      focusKey || (active instanceof HTMLElement && root.contains(active) ? active.dataset.fk : "");
    root.innerHTML = markup();

    const now = new Set<string>();
    for (const block of root.querySelectorAll<HTMLElement>("[data-k]")) {
      const key = block.dataset.k ?? "";
      now.add(key);
      if (rendered && !seen.has(key)) block.classList.add("yui-keyed-enter");
    }
    seen.clear();
    for (const key of now) seen.add(key);
    rendered = true;

    for (const sw of root.querySelectorAll<HTMLElement>('[role="switch"][data-fk]')) {
      const key = sw.dataset.fk ?? "";
      const value = sw.getAttribute("aria-checked") ?? "";
      const prev = switches.get(key);
      if (prev !== undefined && prev !== value) {
        sw.setAttribute("aria-checked", prev);
        void sw.offsetWidth;
        sw.setAttribute("aria-checked", value);
      }
      switches.set(key, value);
    }

    if (focus) {
      const target = Array.from(root.querySelectorAll<HTMLElement>("[data-fk]")).find(
        (node) => node.dataset.fk === focus,
      );
      target?.focus({ preventScroll: true });
    }
  };
}
