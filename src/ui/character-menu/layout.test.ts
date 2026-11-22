import { expect, it } from "vitest";
import { planMenu } from "./layout";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
// Widest pills as measured: the right top column, the left top column, all top items, and each list.
const widths = { right: 101, left: 90, all: 150, lists: [130, 120, 95, 171] };

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
