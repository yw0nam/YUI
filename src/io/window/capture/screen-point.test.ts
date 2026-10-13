import { describe, expect, it } from "vitest";
import { physicalToLogicalScreenPoint } from "./screen-point";

describe("physicalToLogicalScreenPoint", () => {
  it("divides both axes by the given scale, including negative origins", () => {
    expect(physicalToLogicalScreenPoint({ x: 1000, y: 600 }, 2)).toEqual({ x: 500, y: 300 });
    expect(physicalToLogicalScreenPoint({ x: -1200, y: -200 }, 2)).toEqual({ x: -600, y: -100 });
    expect(physicalToLogicalScreenPoint({ x: 2500, y: 400 }, 1)).toEqual({ x: 2500, y: 400 });
  });
});
