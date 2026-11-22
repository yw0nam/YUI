/** Where the Character menu's columns go beside her, and how far the widened window reaches. */

import { roomierSide } from "../../io/window/geometry/quick-card-position";

/** A column's inner edge from her centre: her 64px half-width plus 24px clear. */
const GUTTER_PX = 88;
/** Room past the widest column for its shadow. */
const MARGIN_PX = 16;
const GRID_PX = 8;

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

/** A column's width: its widest pill on the 8px grid. */
export function gridWidth(px: number): number {
  return Math.ceil(px / GRID_PX) * GRID_PX;
}

/** A column's left edge for its side and width, from her centre. */
export function columnLeft(side: "left" | "right", centre: number, width: number): number {
  return side === "right" ? centre + GUTTER_PX : centre - GUTTER_PX - width;
}

const reach = (widest: number): number => GUTTER_PX + gridWidth(widest) + MARGIN_PX;

/** Two columns while both fit the work area at their widest, else one on the roomier side. */
export function planMenu(input: {
  centre: number;
  half: number;
  workArea: { x: number; y: number; width: number; height: number };
  widths: MenuWidths;
}): MenuPlan {
  const { centre, half, workArea, widths } = input;
  const left = reach(Math.max(widths.left, ...widths.lists));
  const right = reach(widths.right);
  if (centre - left >= workArea.x && centre + right <= workArea.x + workArea.width)
    return { fold: "none", reachLeft: Math.max(half, left), reachRight: Math.max(half, right) };
  const side = roomierSide({ left: centre, right: centre }, workArea);
  const folded = Math.max(half, reach(Math.max(widths.all, ...widths.lists)));
  return side === "right"
    ? { fold: "right", reachLeft: half, reachRight: folded }
    : { fold: "left", reachLeft: folded, reachRight: half };
}
