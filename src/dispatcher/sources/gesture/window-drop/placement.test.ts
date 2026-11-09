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
  const setPositionLogical = vi.fn(async (x: number, y: number) => {
    pos = { x: x * 2, y: y * 2 };
  });
  return {
    setPositionLogical,
    deps: {
      renderer: { getPerchProbe: vi.fn(() => ({ seatPx: { x: 40, y: 30 }, charHpx: 200 })) },
      invoke: vi.fn(async () => windows),
      getWindow: () => ({
        outerPosition: vi.fn(async () => pos),
        scaleFactor: vi.fn(async () => 2),
        setPositionLogical,
      }),
      getPeekConfig: () => avatarFixture().peek,
      stopFollow: vi.fn(),
      commitSit: vi.fn(async () => ({ kind: "sit" as const })),
      commitPeek: vi.fn(() => ({ kind: "peek" as const })),
    },
  };
}

describe("placement", () => {
  it("moves the pet window so the seat lands on the named window's top edge", async () => {
    const { deps, setPositionLogical } = makeDeps([win({ ownerName: "Notes" })]);
    const placeOn = createPlacement(deps);

    const result = await placeOn({ kind: "sit", app: "Notes" });

    // Desired seat = top-edge center (560, 400); seat is at (300, 400) → delta (260, 0) points.
    // New logical origin = (520/2 + 260, 740/2 + 0).
    expect(setPositionLogical).toHaveBeenCalledWith(520, 370);
    expect(result).toEqual({ ok: true, kind: "sit" });
  });

  it("commits with the position and scale read after a move onto a monitor of another scale", async () => {
    // Starts at physical (520, 740) on scale 1; the move lands on a scale-2 monitor.
    let landed = false;
    const setPositionLogical = vi.fn(async () => {
      landed = true;
    });
    const { deps } = makeDeps([win({ ownerName: "Notes" })]);
    const placeOn = createPlacement({
      ...deps,
      getWindow: () => ({
        outerPosition: async () => (landed ? { x: 1040, y: 740 } : { x: 520, y: 740 }),
        scaleFactor: async () => (landed ? 2 : 1),
        setPositionLogical,
      }),
    });

    await placeOn({ kind: "sit", app: "Notes" });

    // Seat (560, 770) → target (560, 400): logical origin (520, 740) moves by (0, -370).
    expect(setPositionLogical).toHaveBeenCalledWith(520, 370);
    expect(deps.commitSit).toHaveBeenCalledWith(
      expect.objectContaining({ windowNumber: 7 }),
      { x: 1040, y: 740 },
      2,
      200,
      true,
    );
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
