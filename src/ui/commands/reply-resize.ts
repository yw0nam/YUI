import { subscribe, t } from "../i18n";

export function createReplyResize({ card, onResize }: { card: HTMLElement; onResize: () => void }) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "yui-cmd-reply__resize";
  card.prepend(handle);
  let height: number | null = null;
  let press: { id: number; y: number; height: number } | null = null;

  function setHeight(next: number): void {
    const room = Math.max(0, Math.min(window.innerHeight, card.getBoundingClientRect().bottom) - 8);
    height = Math.min(Math.max(96, next), room);
    card.classList.add("is-resized");
    card.style.height = `${height}px`;
    onResize();
  }
  function refresh(): void {
    if (card.hidden) return;
    if (height !== null) setHeight(height);
    else onResize();
  }
  function down(e: PointerEvent): void {
    e.stopPropagation();
    if (e.button !== 0 || press) return;
    e.preventDefault();
    press = { id: e.pointerId, y: e.clientY, height: card.getBoundingClientRect().height };
    handle.classList.add("is-resizing");
    handle.setPointerCapture(e.pointerId);
  }
  function move(e: PointerEvent): void {
    if (!press || press.id !== e.pointerId) return;
    e.stopPropagation();
    if (e.clientY !== press.y || height !== null) setHeight(press.height + press.y - e.clientY);
  }
  function release(): void {
    const id = press?.id;
    press = null;
    handle.classList.remove("is-resizing");
    if (id !== undefined && handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  function up(e: PointerEvent): void {
    if (!press || press.id !== e.pointerId) return;
    move(e);
    release();
  }
  function cancel(e: PointerEvent): void {
    if (!press || press.id !== e.pointerId) return;
    e.stopPropagation();
    release();
  }
  function key(e: KeyboardEvent): void {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    setHeight(card.getBoundingClientRect().height + (e.key === "ArrowUp" ? 24 : -24));
  }
  const labels = (): void => handle.setAttribute("aria-label", t("command.resize"));
  labels();
  const offLocale = subscribe(labels);
  handle.addEventListener("pointerdown", down);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  handle.addEventListener("keydown", key);
  window.addEventListener("resize", refresh);
  return {
    refresh,
    dispose(): void {
      release();
      offLocale();
      handle.removeEventListener("pointerdown", down);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", cancel);
      handle.removeEventListener("lostpointercapture", cancel);
      handle.removeEventListener("keydown", key);
      window.removeEventListener("resize", refresh);
      handle.remove();
    },
  };
}
