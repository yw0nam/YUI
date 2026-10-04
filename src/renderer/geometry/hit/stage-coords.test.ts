/**
 * stage-coords.test.ts
 *
 * Pins the client→stage-local conversion the renderer now owns (previously
 * duplicated in main.ts as a cached rect + its own resize listener).
 */

import { describe, expect, it } from "vitest";
import { clientToStage } from "./stage-coords";

describe("clientToStage", () => {
  it("subtracts the rect origin from the client point", () => {
    expect(clientToStage(120, 80, { left: 20, top: 10 })).toEqual({ x: 100, y: 70 });
  });

  it("is a no-op when the rect origin is at the viewport origin", () => {
    expect(clientToStage(50, 50, { left: 0, top: 0 })).toEqual({ x: 50, y: 50 });
  });

  it("handles a rect origin below/right of the client point (negative result)", () => {
    expect(clientToStage(10, 10, { left: 30, top: 40 })).toEqual({ x: -20, y: -30 });
  });
});
