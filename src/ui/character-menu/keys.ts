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

export function menuKey(_key: string, _shift: boolean, _focus: KeyFocus): KeyMove | null {
  return null;
}
