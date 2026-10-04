/**
 * placement.test.ts — programmatic placement driven directly, with the sit / peek
 * commits stubbed. Cases that assert the envelopes a placement pushes live in
 * window-drop-source.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import { avatarFixture } from "../../../../config/load-test-helpers";
import type { WindowRect } from "../../../../contract";
import { createPlacement } from "./placement";
import { makeWindow, win } from "./test-helpers";

/** Seat at global (300, 400): seatPx (40,30) · pos (520,740) · scale 2. */
function makeDeps(windows: WindowRect[]) {
  let pos = { x: 520, y: 740 };
  const setPositionPhysical = vi.fn(async (x: number, y: number) => {
    pos = { x, y };
  });
  return {
    setPositionPhysical,
    deps: {
      renderer: { getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })) },
      invoke: vi.fn(async () => windows),
      getWindow: () => ({
        outerPosition: vi.fn(async () => pos),
        scaleFactor: vi.fn(async () => 2),
        setPositionPhysical,
      }),
      getPeekConfig: () => avatarFixture().peek,
      commitSit: vi.fn(async () => ({ kind: "sit" as const })),
      commitPeek: vi.fn(() => ({ kind: "peek" as const })),
    },
  };
}

describe("placement", () => {
  it("moves the pet window so the seat lands on the named window's top edge", async () => {
    const { deps, setPositionPhysical } = makeDeps([win({ ownerName: "Notes" })]);
    const placeOn = createPlacement(deps);

    const result = await placeOn({ kind: "sit", app: "Notes" });

    // Desired seat = top-edge center (560, 400); seat is at (300, 400) → delta (260, 0) points.
    // New physical origin = (520 + 260*2, 740 + 0).
    expect(setPositionPhysical).toHaveBeenCalledWith(1040, 740);
    expect(result).toEqual({ ok: true, kind: "sit" });
  });

  it("reports not_found for a peek when no window is on screen", async () => {
    const placeOn = createPlacement(makeDeps([]).deps);

    expect(await placeOn({ kind: "peek", side: "left" })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("reports unsupported when there is no perch probe", async () => {
    const { deps } = makeDeps([win({ ownerName: "Notes" })]);
    deps.renderer.getPerchProbe = vi.fn(() => null as never);
    const placeOn = createPlacement(deps);

    expect(await placeOn({ kind: "sit", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });

  it("reports unsupported when the window cannot be moved", async () => {
    const { deps } = makeDeps([win({ ownerName: "Notes" })]);
    const placeOn = createPlacement({
      ...deps,
      getWindow: () => makeWindow({ x: 520, y: 740 }, 2),
    });

    expect(await placeOn({ kind: "sit", app: "Notes" })).toEqual({
      ok: false,
      reason: "unsupported",
    });
  });
});
