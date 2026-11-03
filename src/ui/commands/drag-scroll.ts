export function attachDragScroll(
  el: HTMLElement,
  onClick?: (target: EventTarget | null) => void,
): () => void {
  let press: {
    id: number;
    x: number;
    y: number;
    top: number;
    target: EventTarget | null;
    dragged: boolean;
  } | null = null;
  let suppressClick = false;

  function down(e: PointerEvent): void {
    e.stopPropagation();
    if (e.button !== 0 || press) return;
    e.preventDefault();
    suppressClick = false;
    press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      top: el.scrollTop,
      target: e.target,
      dragged: false,
    };
    el.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (!press || press.id !== e.pointerId) return;
    e.stopPropagation();
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) >= 4) press.dragged = true;
    if (press.dragged) el.scrollTop = press.top + press.y - e.clientY;
  }
  function release(): void {
    const id = press?.id;
    press = null;
    if (id !== undefined && el.hasPointerCapture(id)) el.releasePointerCapture(id);
  }
  function up(e: PointerEvent): void {
    if (!press || press.id !== e.pointerId) return;
    move(e);
    const { dragged, target } = press;
    suppressClick = dragged;
    release();
    if (!dragged) onClick?.(target);
  }
  function cancel(e: PointerEvent): void {
    if (!press || press.id !== e.pointerId) return;
    e.stopPropagation();
    suppressClick = true;
    release();
  }
  function click(e: MouseEvent): void {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("lostpointercapture", cancel);
  el.addEventListener("click", click, true);
  return () => {
    release();
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("lostpointercapture", cancel);
    el.removeEventListener("click", click, true);
  };
}
