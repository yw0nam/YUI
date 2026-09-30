import { describe, expect, it, vi } from "vitest";
import { createStageTap } from "./stage-tap";

describe("createStageTap", () => {
  it("hands the tap to the tap source in stage px, reading the rect on each tap", () => {
    let rect = { left: 0, top: 48 };
    const handleClick = vi.fn();
    const tap = createStageTap({
      stage: { getBoundingClientRect: () => rect as DOMRect },
      tapSource: { handleClick },
    });

    tap({ x: 100, y: 148 });
    expect(handleClick).toHaveBeenLastCalledWith({ x: 100, y: 100 });

    rect = { left: 10, top: 20 };
    tap({ x: 100, y: 148 });
    expect(handleClick).toHaveBeenLastCalledWith({ x: 90, y: 128 });
  });
});
