import "./scroll-fade.css";

/** Marks `el` while more of its content sits below its visible part; its bottom edge then fades. */
export function markClipped(el: HTMLElement): void {
  el.classList.add("yui-scroll-fade");
  el.classList.toggle("is-clipped", el.scrollHeight - el.scrollTop - el.clientHeight > 1);
}
