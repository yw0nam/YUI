/** The hit check over DOM targets that the pet window and the Character menu window share. */

/** Whether the point (window-local CSS px) lies within `margin` of an element under `root` that one of `selectors` matches. */
export function overSelectors(
  root: ParentNode,
  selectors: readonly string[],
  x: number,
  y: number,
  margin: number,
): boolean {
  return selectors.some((selector) =>
    [...root.querySelectorAll(selector)].some((el) => {
      const r = el.getBoundingClientRect();
      return (
        x >= r.left - margin &&
        x <= r.right + margin &&
        y >= r.top - margin &&
        y <= r.bottom + margin
      );
    }),
  );
}
