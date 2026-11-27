import { expect, it } from "vitest";
import { planMenu, planMenuWindow, planTop } from "./layout";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
// Widest pills as measured: the right top column, the left top column, all top items, and each list.
const widths = {
  right: 101,
  left: 90,
  all: 150,
  lists: [130, 120, 95, 171],
  rows: { none: 6, folded: 8 },
};

it.each([
  // 88 from her centre, then the column on the 8px grid, then the 16px shadow margin.
  ["two columns mid-screen", 720, widths, { fold: "none", reachLeft: 280, reachRight: 208 }],
  [
    "her own half where a column is narrower",
    720,
    { ...widths, right: 40 },
    { fold: "none", reachLeft: 280, reachRight: 200 },
  ],
  [
    "one column on her right near the left edge",
    250,
    widths,
    { fold: "right", reachLeft: 200, reachRight: 280 },
  ],
  [
    "one column on her left near the right edge",
    1300,
    widths,
    { fold: "left", reachLeft: 280, reachRight: 200 },
  ],
] as const)("plans %s", (_name, centre, measured, plan) => {
  expect(planMenu({ centre, half: 200, workArea, widths: measured })).toEqual(plan);
});

it.each([
  [
    "under her head where the list fits",
    { windowBottom: 600, workBottom: 900 },
    256,
    { top: 120, growUp: 0 },
  ],
  [
    "8px above the window bottom",
    { windowBottom: 284, workBottom: 900 },
    256,
    { top: 20, growUp: 0 },
  ],
  [
    "8px above the work-area bottom",
    { windowBottom: 600, workBottom: 300 },
    256,
    { top: 36, growUp: 0 },
  ],
  [
    "8px below a window grown up for it",
    { windowBottom: 284, workBottom: 900 },
    344,
    { top: -68, growUp: 76 },
  ],
] as const)("puts the columns' top %s", (_name, bottoms, height, plan) => {
  expect(planTop({ head: 120, height, ...bottoms })).toEqual(plan);
});

it.each([
  [
    "two columns around her with room on both sides",
    { x: 520, y: 300, width: 400, height: 600 },
    240,
    {
      fold: "none",
      top: 240,
      rect: { x: 440, y: 300, width: 488, height: 600 },
      box: { left: 80, top: 0, width: 400, height: 600 },
    },
  ],
  [
    "one column on her left near the work area's right edge",
    { x: 1100, y: 300, width: 400, height: 600 },
    240,
    {
      fold: "left",
      top: 240,
      rect: { x: 1020, y: 300, width: 480, height: 600 },
      box: { left: 80, top: 0, width: 400, height: 600 },
    },
  ],
  [
    "a window grown 12px above hers for a column taller than her window",
    { x: 520, y: 100, width: 400, height: 260 },
    120,
    {
      fold: "none",
      top: -4,
      rect: { x: 440, y: 88, width: 488, height: 272 },
      box: { left: 80, top: 12, width: 400, height: 260 },
    },
  ],
] as const)("plans the menu window for %s", (_name, frame, head, plan) => {
  expect(planMenuWindow({ frame, workArea, widths, head })).toEqual(plan);
});
