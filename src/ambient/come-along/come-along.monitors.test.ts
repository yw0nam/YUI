import { describe, expect, it } from "vitest";
import { avatarFixture } from "../../config/load-test-helpers";
import type { StageSlot } from "../../io/bridge/settings-bridge";
import type { ScreenMonitor } from "../../io/window/geometry/screen-geometry";
import { createTravelFrame, type FrameWindow } from "../../io/window/geometry/travel-frame";
import { createComeAlong } from "./come-along";

// The owner's displays, logical: the built-in at scale 2 under two scale-1 externals.
const logicalMonitors = [
  { x: 0, y: 0, width: 1728, height: 1117, top: 33, scale: 2 },
  { x: 878, y: -1080, width: 1920, height: 1080, top: -1080, scale: 1 },
  { x: -1042, y: -1080, width: 1920, height: 1080, top: -1080, scale: 1 },
];
// Tauri reports a macOS monitor's origin and size in its own physical px.
const monitors: ScreenMonitor[] = logicalMonitors.map((m) => ({
  position: { x: m.x * m.scale, y: m.y * m.scale },
  size: { width: m.width * m.scale, height: m.height * m.scale },
  workArea: {
    position: { x: m.x * m.scale, y: m.top * m.scale },
    size: { width: m.width * m.scale, height: (m.y + m.height - m.top) * m.scale },
  },
  scaleFactor: m.scale,
}));
// Main's settings window on external B, outer (-662, -965), a 32 pt title bar: the slot's top is -933.
const slot: StageSlot = { x: -662, y: -933, width: 400, height: 600, scale: 1 };
const FEET = 257;

/** A macOS window: a logical frame whose reads are in the px of the screen it overlaps most. */
function macWindow(frame: { x: number; y: number; width: number; height: number }) {
  const scale = (): number => {
    let best = logicalMonitors[0]!;
    let most = -1;
    for (const m of logicalMonitors) {
      const w = Math.min(frame.x + frame.width, m.x + m.width) - Math.max(frame.x, m.x);
      const h = Math.min(frame.y + frame.height, m.y + m.height) - Math.max(frame.y, m.y);
      const area = Math.max(0, w) * Math.max(0, h);
      if (area > most) {
        most = area;
        best = m;
      }
    }
    return best.scale;
  };
  const win: FrameWindow = {
    outerPosition: async () => ({ x: frame.x * scale(), y: frame.y * scale() }),
    outerSize: async () => ({ width: frame.width * scale(), height: frame.height * scale() }),
    scaleFactor: async () => scale(),
    setPositionLogical: async (x, y) => {
      Object.assign(frame, { x, y });
    },
    setFrameLogical: async (x, y, width, height) => {
      Object.assign(frame, { x, y, width, height });
    },
  };
  return { frame, win };
}

function cycle(at = { x: -48, y: 860 }) {
  const { frame, win } = macWindow({ ...at, width: 200, height: 300 });
  const ticks = new Set<(ctx: { dt: number }) => void>();
  /** Travel frames widened, her canvas's vanish, land and appear, and her drop home, in order. */
  const events: string[] = [];
  const travel = createTravelFrame({
    frame: win,
    renderer: { setViewWindow: () => {} },
    listMonitors: async () => monitors,
    setKeepOnScreenPaused: () => {},
  });
  const items = new Map<string, string>();
  const comeAlong = createComeAlong({
    settingsLabel: "settings",
    storage: {
      getItem: (key) => items.get(key) ?? null,
      setItem: (key, value) => void items.set(key, value),
      removeItem: (key) => void items.delete(key),
    },
    isBusy: () => false,
    peek: { active: () => false, exit: async () => {} },
    locomotion: {
      hold: () => {},
      abortTravel: () => travel.abort(),
      widen: async (via) => {
        events.push("widen");
        const [pos, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()]);
        return travel.begin({ x: pos.x / scale, y: pos.y / scale }, via);
      },
      release: () => {},
      drop: async () => {
        events.push("drop");
      },
      isTravelling: () => travel.current() !== null,
      frame: { frameWindow: () => win, listMonitors: async () => monitors },
    },
    renderer: {
      onTick: (fn) => {
        const cb = fn as (ctx: { dt: number }) => void;
        ticks.add(cb);
        return () => ticks.delete(cb);
      },
      playMotion: () => {},
      getCurrentMotion: () => null,
      setBodyYaw: () => {},
      getCharacterAnchor: () => ({ x: 100, y: FEET }),
      vanish: async () => {
        events.push("vanish");
      },
      land: async (origin) => {
        events.push(`land ${JSON.stringify(origin)}`);
      },
      appear: async () => {
        events.push("appear");
      },
    },
    hitTest: { setMoving: () => {} },
    dock: { attach: async () => true, detach: async () => {} },
    setPositionPhysical: async () => {},
    followsInPhysicalPx: false,
    reducedMotion: () => false,
    stage: () => avatarFixture().stage,
    lastEmotion: () => "neutral",
    random: () => 0,
  });
  /** Ticks 16 ms frames until `step` settles, however she travels. */
  const walk = async (step: Promise<void>) => {
    let settled = false;
    const settle = () => {
      settled = true;
    };
    step.then(settle, settle);
    while (!settled) {
      for (const cb of [...ticks]) cb({ dt: 0.016 });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await step;
  };
  return { frame, comeAlong, walk, events };
}

describe("come-along across monitors of different scale", () => {
  it("docks on the built-in's own stage and goes home there, the same-monitor path", async () => {
    const { frame, comeAlong, walk } = cycle();
    const builtInSlot: StageSlot = { x: 400, y: 120, width: 400, height: 600, scale: 2 };

    await walk(comeAlong.onStage(builtInSlot));
    const docked = `${frame.x},${frame.y} ${frame.width}x${frame.height}`;
    await walk(comeAlong.onStage(null));

    expect([docked, `${frame.x},${frame.y} ${frame.width}x${frame.height}`]).toEqual([
      "500,463 200x300",
      "-48,860 200x300",
    ]);
  });

  it("docks, goes home, docks again and goes home again at her own size and spot", async () => {
    const { frame, comeAlong, walk } = cycle();
    const frames: string[] = [];
    const note = () => frames.push(`${frame.x},${frame.y} ${frame.width}x${frame.height}`);

    await walk(comeAlong.onStage(slot));
    note();
    await walk(comeAlong.onStage(null));
    note();
    await walk(comeAlong.onStage(slot));
    note();
    await walk(comeAlong.onStage(null));
    note();

    expect(frames).toEqual([
      "-562,-590 200x300",
      "-48,860 200x300",
      "-562,-590 200x300",
      "-48,860 200x300",
    ]);
  });

  it("vanishes and lands on another monitor's stage under 1200 pt away", async () => {
    // From the built-in's top edge onto a stage on external A, about 500 pt away.
    const { frame, comeAlong, walk, events } = cycle({ x: 900, y: 100 });
    const aSlot: StageSlot = { x: 1000, y: -700, width: 400, height: 600, scale: 1 };

    await walk(comeAlong.onStage(aSlot));

    expect(events).toEqual(["vanish", `land {"x":100,"y":${FEET}}`]);
    expect(`${frame.x},${frame.y}`).toBe("1100,-357");
  });

  it("goes home across monitors by vanishing, landing at her spot, then dropping", async () => {
    const { frame, comeAlong, walk, events } = cycle();
    await walk(comeAlong.onStage(slot));
    events.length = 0;

    await walk(comeAlong.onStage(null));

    expect(events).toEqual(["vanish", `land {"x":100,"y":${FEET}}`, "drop"]);
    expect(`${frame.x},${frame.y}`).toBe("-48,860");
  });
});
