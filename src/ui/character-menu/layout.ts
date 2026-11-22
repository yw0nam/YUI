/** Where the Character menu's columns go beside her, and how far the widened window reaches. */

export type Fold = "none" | "left" | "right";

/** The widest pill of each column state, as measured in the DOM (px). */
export interface MenuWidths {
  right: number;
  left: number;
  /** The one folded column of every top-level item. */
  all: number;
  lists: readonly number[];
}

export interface MenuPlan {
  fold: Fold;
  /** How far the widened window reaches left and right of her centre (px). */
  reachLeft: number;
  reachRight: number;
}

export function planMenu(_input: {
  centre: number;
  half: number;
  workArea: { x: number; y: number; width: number; height: number };
  widths: MenuWidths;
}): MenuPlan {
  return { fold: "none", reachLeft: 0, reachRight: 0 };
}
