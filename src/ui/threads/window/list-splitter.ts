/**
 * The wide list's edge, a window splitter: a drag or Left / Right sets the list width, a
 * double-click goes back to the default. One CSS variable on the panel carries the width to every
 * tab's panes; the stylesheet clamps it to the range, so a narrower window narrows the list too.
 */

import "./list-splitter.css";
import { LIST_WIDTH_PX } from "../../../settings/threads/threads-window-settings";
import { subscribe as subscribeLocale, t } from "../../i18n";

const STEP_PX = 16;
const VAR = "--yui-threads-list-width";
const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

export interface ListSplitter {
  /** Lays an edge after `list`, in its tab's panes. */
  attach(list: HTMLElement): void;
  dispose(): void;
}

export function createListSplitter(deps: {
  /** Carries the width variable; half its width is the widest list. */
  panel: HTMLElement;
  /** The stored width; null for the default. */
  width: number | null;
  onWidth(width: number | null): void;
}): ListSplitter {
  const { panel } = deps;
  const edges: { edge: HTMLElement; list: HTMLElement }[] = [];
  let dragging = false;
  const max = (): number => Math.min(LIST_WIDTH_PX.max, Math.floor(panel.clientWidth / 2));
  const clamp = (w: number): number => Math.round(Math.max(LIST_WIDTH_PX.min, Math.min(max(), w)));
  const shown = (list: HTMLElement): number => list.getBoundingClientRect().width;

  function set(width: number | null): void {
    if (width === null) panel.style.removeProperty(VAR);
    else panel.style.setProperty(VAR, `${width}px`);
  }

  /** Reports the shown tab's list width and range; a hidden tab's edge keeps what it had. */
  function sync(): void {
    for (const { edge, list } of edges) {
      edge.setAttribute("aria-label", t("threads.list_width"));
      const width = shown(list);
      if (width === 0) continue;
      const top = max();
      edge.setAttribute("aria-valuemax", String(top));
      edge.setAttribute("aria-valuenow", String(Math.min(top, Math.round(width))));
    }
  }

  function save(width: number | null): void {
    set(width);
    sync();
    deps.onWidth(width);
  }

  // A panel or list resize moves the range and the shown width; a drag reports at its end.
  const observer = new ResizeObserver(() => {
    if (!dragging) sync();
  });
  observer.observe(panel);
  const offLocale = subscribeLocale(sync);
  set(deps.width);

  function attach(list: HTMLElement): void {
    const edge = document.createElement("div");
    edge.className = "yui-threads-split";
    edge.tabIndex = 0;
    edge.setAttribute("role", "separator");
    edge.setAttribute("aria-orientation", "vertical");
    edge.setAttribute("aria-controls", list.id);
    edge.setAttribute("aria-valuemin", String(LIST_WIDTH_PX.min));

    edge.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || dragging) return;
      down.preventDefault();
      edge.setPointerCapture(down.pointerId);
      dragging = true;
      edge.dataset.dragging = "true";
      // Where the list would start for the grab point to stay under the pointer.
      const origin = down.clientX - shown(list);
      let width: number | null = null;
      const move = (e: PointerEvent): void => {
        width = clamp(e.clientX - origin);
        set(width);
      };
      // A lost capture or a cancel ends the drag like a release.
      const end = (): void => {
        edge.removeEventListener("pointermove", move);
        for (const type of ENDS) edge.removeEventListener(type, end);
        dragging = false;
        delete edge.dataset.dragging;
        if (width !== null) save(width);
      };
      edge.addEventListener("pointermove", move);
      for (const type of ENDS) edge.addEventListener(type, end);
    });

    edge.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? STEP_PX : e.key === "ArrowLeft" ? -STEP_PX : 0;
      if (!step) return;
      e.preventDefault();
      save(clamp(shown(list) + step));
    });

    edge.addEventListener("dblclick", () => save(null));
    edge.addEventListener("focus", sync);
    list.after(edge);
    edges.push({ edge, list });
    observer.observe(list);
    sync();
  }

  return {
    attach,
    dispose() {
      observer.disconnect();
      offLocale();
    },
  };
}
