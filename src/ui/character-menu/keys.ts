/** The Character menu's keyboard: which key moves focus where, goes back, or closes. */

export interface KeyFocus {
  /** Row counts of the columns, left to right. */
  rows: readonly number[];
  column: number;
  row: number;
  /** The column showing a list, or null at the top level. */
  listColumn: number | null;
  /** A confirm row is open. */
  confirming: boolean;
  /** Focus sits in the confirm row. */
  inConfirm: boolean;
}

export type KeyMove =
  | { kind: "focus"; column: number; row: number }
  | { kind: "cancel"; to?: { column: number; row: number } }
  | { kind: "swap" }
  | { kind: "tab"; by: 1 | -1 }
  | { kind: "back" }
  | { kind: "close" };

export function menuKey(key: string, shift: boolean, focus: KeyFocus): KeyMove | null {
  const { rows, column, row, listColumn, confirming, inConfirm } = focus;
  const last = (rows[column] ?? 1) - 1;
  const to = (r: number): KeyMove => ({ kind: "focus", column, row: r });
  switch (key) {
    case "Escape":
      if (confirming) return { kind: "cancel" };
      return listColumn === null ? { kind: "close" } : { kind: "back" };
    case "ArrowDown":
    case "ArrowUp": {
      const next = key === "ArrowDown" ? (row === last ? 0 : row + 1) : row === 0 ? last : row - 1;
      // Leaving a confirm row by ↑ or ↓ cancels it first.
      return inConfirm ? { kind: "cancel", to: { column, row: next } } : to(next);
    }
    case "Home":
      return to(0);
    case "End":
      return to(last);
    case "ArrowLeft":
    case "ArrowRight": {
      if (inConfirm) return { kind: "swap" };
      if (key === "ArrowLeft" && column === listColumn) return { kind: "back" };
      const next = column + (key === "ArrowLeft" ? -1 : 1);
      const count = rows[next];
      return count === undefined
        ? null
        : { kind: "focus", column: next, row: Math.min(row, count - 1) };
    }
    case "Tab":
      return { kind: "tab", by: shift ? -1 : 1 };
    default:
      return null;
  }
}
