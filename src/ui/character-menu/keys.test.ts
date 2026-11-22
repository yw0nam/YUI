import { expect, it } from "vitest";
import { type KeyFocus, menuKey } from "./keys";

// Two columns, left to right: the left one with four rows, the right one with three.
const at = (column: number, row: number, over: Partial<KeyFocus> = {}): KeyFocus => ({
  rows: [4, 3],
  column,
  row,
  listColumn: null,
  confirming: false,
  inConfirm: false,
  ...over,
});

it.each([
  [
    "↓ wraps to the column's first row",
    "ArrowDown",
    false,
    at(0, 3),
    { kind: "focus", column: 0, row: 0 },
  ],
  [
    "↑ wraps to the column's last row",
    "ArrowUp",
    false,
    at(1, 0),
    { kind: "focus", column: 1, row: 2 },
  ],
  [
    "→ moves to the same row, kept inside a shorter column",
    "ArrowRight",
    false,
    at(0, 3),
    { kind: "focus", column: 1, row: 2 },
  ],
  [
    "← moves to the column on the left",
    "ArrowLeft",
    false,
    at(1, 1),
    { kind: "focus", column: 0, row: 1 },
  ],
  ["← in a list goes back", "ArrowLeft", false, at(0, 2, { listColumn: 0 }), { kind: "back" }],
  [
    "Home goes to the column's first row",
    "Home",
    false,
    at(0, 2),
    { kind: "focus", column: 0, row: 0 },
  ],
  [
    "End goes to the column's last row",
    "End",
    false,
    at(0, 1),
    { kind: "focus", column: 0, row: 3 },
  ],
  ["Tab steps forward in keyboard order", "Tab", false, at(0, 1), { kind: "tab", by: 1 }],
  ["Shift+Tab steps back in keyboard order", "Tab", true, at(0, 1), { kind: "tab", by: -1 }],
  [
    "Esc cancels an open confirm",
    "Escape",
    false,
    at(0, 3, { listColumn: 0, confirming: true, inConfirm: true }),
    { kind: "cancel" },
  ],
  ["Esc goes back from a list", "Escape", false, at(0, 1, { listColumn: 0 }), { kind: "back" }],
  ["Esc closes at the top level", "Escape", false, at(1, 1), { kind: "close" }],
  [
    "↓ out of a confirm cancels it, then moves",
    "ArrowDown",
    false,
    at(0, 2, { confirming: true, inConfirm: true }),
    { kind: "cancel", to: { column: 0, row: 3 } },
  ],
  [
    "← inside a confirm swaps between Sure? and Cancel",
    "ArrowLeft",
    false,
    at(0, 2, { listColumn: 0, confirming: true, inConfirm: true }),
    { kind: "swap" },
  ],
] as const)("%s", (_name, key, shift, focus, move) => {
  expect(menuKey(key, shift, focus)).toEqual(move);
});
