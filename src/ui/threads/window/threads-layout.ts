/** The Threads window's layout by its panel's width: wide (list and thread), medium (rail and thread), narrow (one pane). */

/** Pairs with the `@container threads (min-width: 720px)` rule in threads-view.css. */
const WIDE_MIN_PX = 720;
/** Pairs with the `@container threads (min-width: 520px)` rule in threads-view.css. */
const MEDIUM_MIN_PX = 520;

export type ThreadsLayout = "wide" | "medium" | "narrow";

/** The layout a panel content width of `width` px takes. */
export function layoutOf(width: number): ThreadsLayout {
  return width >= WIDE_MIN_PX ? "wide" : width >= MEDIUM_MIN_PX ? "medium" : "narrow";
}
