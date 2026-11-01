/**
 * The wide list's edge, a window splitter: a drag or Left / Right sets the list width, a
 * double-click goes back to the default. One CSS variable on the panel carries the width to every
 * tab's panes; the stylesheet clamps it to the range, so a narrower window narrows the list too.
 */

import "./list-splitter.css";
import { t } from "../../i18n";

/** Pairs with the clamp on `.yui-threads__panes` in threads-view.css. */
const MIN_PX = 220;
const MAX_PX = 480;
const STEP_PX = 16;
const VAR = "--yui-threads-list-width";
const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

export function createListSplitter(deps: {
  /** Carries the width variable; half its width is the widest list. */
  panel: HTMLElement;
  /** The stored width; null for the default. */
  width: number | null;
  onWidth(width: number | null): void;
}): { separator(): HTMLElement } {
  const { panel } = deps;
  const edges: HTMLElement[] = [];
  let stored = deps.width;
  const max = (): number => Math.min(MAX_PX, Math.floor(panel.clientWidth / 2));
  const clamp = (w: number): number => Math.round(Math.max(MIN_PX, Math.min(max(), w)));

  /** The list's shown width once the edge sits beside it, else the stored one. */
  function sync(edge: HTMLElement): void {
    const list = edge.parentElement?.querySelector(".yui-threads-list");
    const shown = list ? Math.round(list.getBoundingClientRect().width) : stored;
    edge.setAttribute("aria-label", t("threads.list_width"));
    edge.setAttribute("aria-valuemax", String(max()));
    if (shown !== null) edge.setAttribute("aria-valuenow", String(shown));
  }

  function set(width: number | null): void {
    stored = width;
    if (width === null) panel.style.removeProperty(VAR);
    else panel.style.setProperty(VAR, `${width}px`);
    for (const edge of edges) sync(edge);
  }

  function separator(): HTMLElement {
    const edge = document.createElement("div");
    edge.className = "yui-threads-split";
    edge.tabIndex = 0;
    edge.setAttribute("role", "separator");
    edge.setAttribute("aria-orientation", "vertical");
    edge.setAttribute("aria-valuemin", String(MIN_PX));
    edges.push(edge);

    edge.addEventListener("pointerdown", (down) => {
      if (down.button !== 0) return;
      down.preventDefault();
      edge.setPointerCapture(down.pointerId);
      edge.dataset.dragging = "true";
      const left = edge.parentElement!.getBoundingClientRect().left;
      let width: number | null = null;
      const move = (e: PointerEvent): void => {
        width = clamp(e.clientX - left);
        set(width);
      };
      // A lost capture or a cancel ends the drag like a release.
      const end = (): void => {
        edge.removeEventListener("pointermove", move);
        for (const type of ENDS) edge.removeEventListener(type, end);
        delete edge.dataset.dragging;
        if (width !== null) deps.onWidth(width);
      };
      edge.addEventListener("pointermove", move);
      for (const type of ENDS) edge.addEventListener(type, end);
    });

    edge.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? STEP_PX : e.key === "ArrowLeft" ? -STEP_PX : 0;
      const list = edge.parentElement?.querySelector(".yui-threads-list");
      if (!step || !list) return;
      e.preventDefault();
      const width = clamp(list.getBoundingClientRect().width + step);
      set(width);
      deps.onWidth(width);
    });

    edge.addEventListener("dblclick", () => {
      set(null);
      deps.onWidth(null);
    });

    edge.addEventListener("focus", () => sync(edge));
    sync(edge);
    return edge;
  }

  set(deps.width);
  return { separator };
}
