/**
 * The Threads panel's resize: eight hit areas on its edges (8px) and corners (14px) reporting a
 * drag in screen px, and a readout of the panel's size and layout while the drag lasts.
 */

import "./resize-handles.css";
import type { ResizeEdge } from "../../../io/window/geometry/threads-position";
import { t } from "../../i18n";
import { layoutOf } from "./threads-layout";

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];
const ENDS = ["pointerup", "pointercancel", "lostpointercapture"] as const;

export interface ResizeListener {
  start(): void;
  /** The pointer's travel from the pointerdown, in screen px: the window moves under it on a west or north drag. */
  move(edge: ResizeEdge, dx: number, dy: number): void;
  end(): void;
}

export function attachResizeHandles({
  panel,
  listener,
}: {
  panel: HTMLElement;
  listener: ResizeListener;
}): () => void {
  const readout = document.createElement("span");
  readout.className = "yui-threads-readout";
  readout.hidden = true;
  let observer: ResizeObserver | null = null;

  function showSize(): void {
    const layout = t(`threads.layout_${layoutOf(panel.clientWidth)}`);
    readout.textContent = `${panel.offsetWidth} × ${panel.offsetHeight} · ${layout}`;
  }

  function begin(handle: HTMLElement, edge: ResizeEdge, down: PointerEvent): void {
    if (down.button !== 0 || observer) return;
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    observer = new ResizeObserver(showSize);
    observer.observe(panel);
    showSize();
    listener.start();
    const move = (e: PointerEvent): void => {
      readout.hidden = false;
      listener.move(
        edge,
        Math.round(e.screenX - down.screenX),
        Math.round(e.screenY - down.screenY),
      );
    };
    // A lost capture or a cancel ends the drag like a release.
    const end = (): void => {
      handle.removeEventListener("pointermove", move);
      for (const type of ENDS) handle.removeEventListener(type, end);
      observer?.disconnect();
      observer = null;
      readout.hidden = true;
      listener.end();
    };
    handle.addEventListener("pointermove", move);
    for (const type of ENDS) handle.addEventListener(type, end);
  }

  const handles = EDGES.map((edge) => {
    const el = document.createElement("div");
    el.className = "yui-threads-rz";
    el.dataset.edge = edge;
    el.addEventListener("pointerdown", (e) => begin(el, edge, e));
    return el;
  });
  panel.append(readout, ...handles);

  return () => {
    observer?.disconnect();
    readout.remove();
    for (const el of handles) el.remove();
  };
}
