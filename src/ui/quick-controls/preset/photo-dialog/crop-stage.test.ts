import { describe, expect, it } from "vitest";
import { clampStage, cropOf, stageOf, zoomAbout } from "./crop-stage";

const P = { width: 900, height: 1000 };
/** The photo point under the circle centre (stage px 180), in photo pixels. */
const centrePoint = (st: { zoom: number; left: number; top: number }) => {
  const s = (st.zoom * 300) / 900;
  return [(180 - st.left) / s, (180 - st.top) / s];
};

describe("crop stage", () => {
  it.each([
    { x: 0.1, y: 0.2, size: 0.5 },
    { x: 0, y: 0, size: 1 },
    { x: 0.225, y: 0.06, size: 0.55 },
  ])("cropOf(stageOf(crop)) gives the crop back: %o", (crop) => {
    const back = cropOf(stageOf(crop, P), P);
    expect(back.x).toBeCloseTo(crop.x, 9);
    expect(back.y).toBeCloseTo(crop.y, 9);
    expect(back.size).toBeCloseTo(crop.size, 9);
  });

  it("clampStage keeps the circle covered after a drag past every edge", () => {
    const high = clampStage({ zoom: 2, left: 500, top: 500 }, P);
    expect([high.left, high.top]).toEqual([30, 30]);
    const low = clampStage({ zoom: 2, left: -9999, top: -9999 }, P);
    expect(low.left).toBeCloseTo(-270, 9);
    expect(low.top).toBeCloseTo(-336.6666667, 6);
  });

  it("zoomAbout keeps the photo point under the circle centre", () => {
    const from = stageOf({ x: 0.1, y: 0.2, size: 0.5 }, P);
    const [px, py] = centrePoint(from);
    const to = zoomAbout(from, 3.5, P);
    expect(to.zoom).toBe(3.5);
    expect(centrePoint(to)[0]).toBeCloseTo(px!, 6);
    expect(centrePoint(to)[1]).toBeCloseTo(py!, 6);
  });
});
