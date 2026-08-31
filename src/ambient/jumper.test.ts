import { describe, expect, it, vi } from "vitest";
import type { JumpConfig } from "../config/load";
import type { WindowRect } from "../contract";
import type { TickContext, TickFn } from "../renderer";
import { createJumper, type JumperDeps, type JumpPlan, jumpArc, pickJumpTarget } from "./jumper";

const CFG: JumpConfig = {
  probability: 1,
  height_up_max_frac: 0.5,
  height_down_max_frac: 1,
  gap_max_width_frac: 1.5,
  apex_lift_frac: 0.15,
  takeoff_frac: 0.4,
  land_frac: 0.67,
};

const CHAR_HPX = 500;
const CHAR_WPX = 160;
/** The stroll's own edge margin at this character height (`edge_margin_frac` 0.2). */
const MARGIN = 100;

const HOST: WindowRect = {
  x: 1000,
  y: 900,
  width: 500,
  height: 600,
  name: "Meeting notes",
  ownerName: "Notes",
  pid: 11,
  windowNumber: 42,
};

/** A foreign window with the host's shape, moved and renamed. */
function win(over: Partial<WindowRect> & { windowNumber: number }): WindowRect {
  return { ...HOST, width: 400, name: "Neighbour", ...over };
}

/** Host last: every other entry is in front of it, the way the perch poll reads the stack. */
function pick(windows: WindowRect[], over: Partial<Parameters<typeof pickJumpTarget>[0]> = {}) {
  return pickJumpTarget({
    windows: [...windows, HOST],
    hostIndex: windows.length,
    span: { left: HOST.x, right: HOST.x + HOST.width },
    charHpx: CHAR_HPX,
    charWpx: CHAR_WPX,
    margin: MARGIN,
    cfg: CFG,
    ...over,
  });
}

describe("pickJumpTarget — reach", () => {
  it("takes off inside the host's far margin and lands inside the neighbour's near one", () => {
    expect(pick([win({ x: 1560, windowNumber: 7 })])).toEqual({
      target: win({ x: 1560, windowNumber: 7 }),
      side: "right",
      takeoffX: 1400,
      landingX: 1660,
    });
  });

  it("mirrors the geometry for a neighbour on the left", () => {
    const left = win({ x: 540, windowNumber: 7 });
    expect(pick([left])).toEqual({
      target: left,
      side: "left",
      takeoffX: 1100,
      landingX: 840,
    });
  });

  it("clears a gap up to the configured character widths and no further", () => {
    expect(pick([win({ x: 1500 + 1.5 * CHAR_WPX, windowNumber: 7 })])).not.toBeNull();
    expect(pick([win({ x: 1500 + 1.5 * CHAR_WPX + 1, windowNumber: 7 })])).toBeNull();
  });

  it("steps one body width past the host edge onto an overlapping window", () => {
    const over = win({ x: 1400, windowNumber: 7 });
    expect(pick([over], { span: { left: 1000, right: 1400 } })).toEqual({
      target: over,
      side: "right",
      takeoffX: 1400,
      landingX: 1400 + CHAR_WPX,
    });
  });
});

describe("pickJumpTarget — height", () => {
  it("climbs up to half a character height and no further", () => {
    const up = HOST.y - CFG.height_up_max_frac * CHAR_HPX;
    expect(pick([win({ x: 1560, y: up, windowNumber: 7 })])).not.toBeNull();
    expect(pick([win({ x: 1560, y: up - 1, windowNumber: 7 })])).toBeNull();
  });

  it("drops up to a whole character height and no further", () => {
    const down = HOST.y + CFG.height_down_max_frac * CHAR_HPX;
    expect(pick([win({ x: 1560, y: down, windowNumber: 7 })])).not.toBeNull();
    expect(pick([win({ x: 1560, y: down + 1, windowNumber: 7 })])).toBeNull();
  });
});

describe("pickJumpTarget — reachability", () => {
  it("refuses a takeoff point outside the stretch she can walk", () => {
    expect(
      pick([win({ x: 1560, windowNumber: 7 })], { span: { left: 1000, right: 1300 } }),
    ).toBeNull();
  });

  it("refuses a landing the neighbour has no room to hold inside its own margins", () => {
    expect(pick([win({ x: 1560, width: 150, windowNumber: 7 })])).toBeNull();
  });

  it("refuses a landing seat covered by a window in front of the neighbour", () => {
    const target = win({ x: 1560, windowNumber: 7 });
    // Too far above the host to be jumped to itself, but squarely over the landing seat.
    const cover = win({ x: 1600, y: 500, height: 500, windowNumber: 8 });
    expect(pick([cover, target])).toBeNull();
  });
});

describe("pickJumpTarget — winner", () => {
  it("takes the nearest gap", () => {
    const near = win({ x: 540, windowNumber: 7 });
    const far = win({ x: 1600, windowNumber: 8 });
    expect(pick([far, near])?.target.windowNumber).toBe(7);
  });

  it("breaks a tied gap on the smaller height difference", () => {
    const level = win({ x: 1560, y: 1000, windowNumber: 7 });
    const steep = win({ x: 540, y: 1300, windowNumber: 8 });
    expect(pick([steep, level])?.target.windowNumber).toBe(7);
  });

  it("never picks the host itself", () => {
    expect(pick([])).toBeNull();
  });
});

const TARGET = win({ x: 1560, y: 1200, windowNumber: 7 });
const PLAN: JumpPlan = { target: TARGET, side: "right", takeoffX: 1400, landingX: 1660 };
const ANCHOR = { x: 200, y: 420 };
/** Clip length: takeoff at 0.64 s, landing at 1.072 s. */
const DURATION = 1.6;
/** Window origin standing the feet on the host's edge at `takeoffX`. */
const FROM = { x: 1200, y: 480 };
/** Window origin standing them on the target's edge at `landingX`. */
const TO = { x: 1460, y: 780 };

function makeJumper(
  over: {
    duration?: number | null;
    accepted?: boolean;
    windows?: () => Promise<WindowRect[]>;
  } = {},
) {
  let tick: TickFn | null = null;
  let playing: string | null = null;
  const positions: Array<{ x: number; y: number }> = [];
  const onTakeoff = vi.fn();
  const playMotion = vi.fn((motion: { id: string } | null) => {
    if (over.accepted === false) return;
    playing = motion?.id ?? null;
  });
  const deps: JumperDeps = {
    renderer: {
      onTick: (fn) => {
        tick = fn;
        return () => {
          tick = null;
        };
      },
      playMotion,
      getCurrentMotion: () => (playing ? { id: playing } : null),
      getMotionDuration: () => (over.duration === undefined ? DURATION : over.duration),
    },
    getWindow: () => ({
      outerPosition: async () => ({ ...FROM }),
      setPositionPhysical: async (x, y) => {
        positions.push({ x, y });
      },
    }),
    listWindows: over.windows ?? (async () => [TARGET]),
    getConfig: () => CFG,
    onTakeoff,
  };
  const jumper = createJumper(deps);
  let elapsed = 0;
  const frame = async (dt = 0.1): Promise<void> => {
    // Drain first, so the frame after a jump call sees the tick it subscribed.
    for (let i = 0; i < 12; i++) await Promise.resolve();
    elapsed += dt;
    tick?.({ vrm: {} as never, dt, elapsed } as TickContext);
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  return { jumper, frame, positions, playMotion, onTakeoff };
}

/** Start the jump; the returned promise settles on whatever a later frame decides. */
function flying(h: ReturnType<typeof makeJumper>) {
  return h.jumper.jump(PLAN, { anchor: ANCHOR, charHpx: CHAR_HPX, scale: 1 });
}

describe("createJumper", () => {
  it("holds the window still through the crouch, then travels the arc onto the landing", async () => {
    const h = makeJumper();
    const outcome = flying(h);
    await h.frame(0.6);

    expect(h.positions).toEqual([]);

    await h.frame(0.1);
    const airborne = h.positions.at(-1)!;
    expect(airborne.x).toBeGreaterThan(FROM.x);
    expect(airborne.x).toBeLessThan(TO.x);
    // Screen y grows downward, so clearing the straight line means sitting above it.
    const travelled = (airborne.x - FROM.x) / (TO.x - FROM.x);
    expect(airborne.y).toBeLessThan(FROM.y + (TO.y - FROM.y) * travelled);

    await h.frame(0.5);
    expect(h.positions.at(-1)).toEqual(TO);
    await expect(outcome).resolves.toBe("landed");
  });

  it("pushes the takeoff cue once, as soon as the clip takes the body", async () => {
    const h = makeJumper();
    const outcome = flying(h);
    await h.frame(0.1);

    expect(h.playMotion).toHaveBeenCalledWith({ id: "jump" });
    expect(h.onTakeoff).toHaveBeenCalledTimes(1);

    await h.frame(1.1);
    await expect(outcome).resolves.toBe("landed");
    expect(h.onTakeoff).toHaveBeenCalledTimes(1);
  });

  it("stays put and says nothing when the clip is refused", async () => {
    const h = makeJumper({ accepted: false });

    await expect(flying(h)).resolves.toBe("lost");
    await h.frame(1.2);
    expect(h.positions).toEqual([]);
    expect(h.onTakeoff).not.toHaveBeenCalled();
  });

  it("holds the window still while the clip length is unmeasurable", async () => {
    const h = makeJumper({ duration: null });
    flying(h);

    await h.frame(1.2);

    expect(h.positions).toEqual([]);
  });

  it("stops mid-air when the target window goes away", async () => {
    let windows = [TARGET];
    const h = makeJumper({ windows: async () => windows });
    const outcome = flying(h);
    await h.frame(0.6);
    windows = [];

    // The poll comes due on the first airborne frame, one move after takeoff.
    await h.frame(0.1);
    const stranded = h.positions.length;
    expect(stranded).toBeGreaterThan(0);

    await expect(outcome).resolves.toBe("lost");
    await h.frame(0.5);
    expect(h.positions).toHaveLength(stranded);
  });

  it("stops mid-air when the target window slides away", async () => {
    let windows = [TARGET];
    const h = makeJumper({ windows: async () => windows });
    const outcome = flying(h);
    await h.frame(0.6);
    windows = [{ ...TARGET, x: TARGET.x + 13 }];

    await h.frame(0.1);

    await expect(outcome).resolves.toBe("lost");
  });

  it("cancels silently, leaving the window where the interrupt found it", async () => {
    const h = makeJumper();
    const outcome = flying(h);
    await h.frame(0.7);
    const interrupted = h.positions.length;

    h.jumper.cancel();

    await expect(outcome).resolves.toBe("cancelled");
    await h.frame(0.5);
    expect(h.positions).toHaveLength(interrupted);
    expect(h.playMotion).toHaveBeenCalledTimes(1);
  });
});

describe("jumpArc", () => {
  it("starts and ends exactly on the two tops", () => {
    expect(jumpArc(0, 900, 1200, 75)).toBe(900);
    expect(jumpArc(1, 900, 1200, 75)).toBe(1200);
  });

  it("peaks the configured lift above the higher of the two tops", () => {
    expect(jumpArc(0.5, 900, 1200, 75)).toBeCloseTo(825, 6);
    expect(jumpArc(0.5, 1200, 900, 75)).toBeCloseTo(825, 6);
    expect(jumpArc(0.5, 900, 900, 75)).toBeCloseTo(825, 6);
  });

  it("stays above the straight line between the two tops for the whole flight", () => {
    for (const u of [0.1, 0.25, 0.4, 0.6, 0.75, 0.9]) {
      expect(jumpArc(u, 900, 1200, 75)).toBeLessThan((1 - u) * 900 + u * 1200);
    }
  });
});
