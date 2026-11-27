/** Where the Character menu's columns go beside her, and how far the widened window reaches. */

import type { ScreenRect } from "../../contract";
import { roomierSide } from "../../io/window/geometry/roomier-side";

/** A column's inner edge from her centre: her 64px half-width plus 24px clear. */
const GUTTER_PX = 88;
/** Room past the widest column for its shadow. */
const MARGIN_PX = 16;
const GRID_PX = 8;
/** A pill row's pitch: 36px tall plus the 8px gap; the stylesheet sets the same. */
const ROW_PX = 44;
/** The least room between a column and the edge of her window or the work area. */
const EDGE_PX = 8;

export type Fold = "none" | "left" | "right";

/** The widest pill of each column state, as measured in the DOM (px). */
export interface MenuWidths {
  right: number;
  left: number;
  /** The one folded column of every top-level item. */
  all: number;
  lists: readonly number[];
  /** The most rows any column shows, unfolded and folded. */
  rows: { none: number; folded: number };
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

/** A column of `rows` pills, top of the first to bottom of the last (px). */
export const columnHeight = (rows: number): number => rows * ROW_PX - GRID_PX;

/** The columns' shared top in her box's px, and how far her window grows upward to keep it 8px below its top. */
export function planTop(input: {
  head: number;
  height: number;
  windowBottom: number;
  workBottom: number;
}): { top: number; growUp: number } {
  const { head, height, windowBottom, workBottom } = input;
  const top = Math.min(head, Math.min(windowBottom, workBottom) - EDGE_PX - height);
  return { top, growUp: Math.max(0, EDGE_PX - top) };
}

export function planMenuWindow(_input: {
  frame: ScreenRect;
  workArea: ScreenRect;
  widths: MenuWidths;
  head: number;
}): {
  fold: Fold;
  top: number;
  rect: ScreenRect;
  box: { left: number; top: number; width: number; height: number };
} {
  return {
    fold: "none",
    top: 0,
    rect: { x: 0, y: 0, width: 0, height: 0 },
    box: { left: 0, top: 0, width: 0, height: 0 },
  };
}
