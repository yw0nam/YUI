const MARGIN = 8;
const LIFT = "--yui-sigdetails-lift";

/** Each fitted sheet's slide along its column's, or null while none runs. */
const slides = new WeakMap<HTMLElement, Animation | null>();

/** The vertical move of a `transform` value, computed or inline. */
export const shiftOf = (transform: string): number =>
  transform && transform !== "none" ? new DOMMatrixReadOnly(transform).m42 : 0;

/** Lifts `sheet` to end MARGIN px above the window bottom where `column`'s slide ends, capped to the window. */
export function fitSheet(sheet: HTMLElement, column: HTMLElement): void {
  const shown = slides.has(sheet) ? sheet.getBoundingClientRect().top : null;
  slides.get(sheet)?.cancel();
  slides.set(sheet, null);
  sheet.style.removeProperty(LIFT);
  sheet.style.removeProperty("max-height");
  const ahead = shiftOf(column.style.transform) - shiftOf(getComputedStyle(column).transform);
  const rect = sheet.getBoundingClientRect();
  const room = window.innerHeight - 2 * MARGIN;
  let lift = rect.bottom + ahead - (window.innerHeight - MARGIN);
  if (rect.height > room) {
    sheet.style.maxHeight = `${room}px`;
    lift = rect.top + ahead - MARGIN;
  }
  if (lift > 0) sheet.style.setProperty(LIFT, `${lift}px`);
  const fitted = rect.top - Math.max(lift, 0);
  // A new sheet holds where it settles; a shown one starts where it shows.
  if (ahead !== 0) slideAlong(sheet, column, (shown ?? fitted + ahead) - fitted);
}

/** Moves `sheet` by `offset` px now, easing to 0 on the curve of `column`'s running slide. */
function slideAlong(sheet: HTMLElement, column: HTMLElement, offset: number): void {
  const transition = column
    .getAnimations()
    .find(
      (a): a is CSSTransition => a instanceof CSSTransition && a.transitionProperty === "transform",
    );
  const progress = transition?.effect?.getComputedTiming().progress;
  if (!transition?.effect || progress == null || progress >= 1) return;
  // The offset shrinks with the column's eased progress, so it is scaled by the part still to run.
  const slide = sheet.animate(
    [{ translate: `0 ${offset / (1 - progress)}px` }, { translate: "0 0" }],
    transition.effect.getTiming(),
  );
  if (transition.startTime !== null) slide.startTime = transition.startTime;
  slides.set(sheet, slide);
}
