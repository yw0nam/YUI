import { describe, expect, it, vi } from "vitest";
import type { RenderMotionSignal, TickContext, TickFn } from "../../renderer";
import { createSitter, type SitterDeps } from "./sitter";

/** Feet and seat in canvas-local logical px while standing: the seat is 120 px up. */
const ANCHOR = { x: 200, y: 420 };
const SEAT = { x: 200, y: 300 };
const SIT = { id: "window_sit", fade_ms: 500 };

function makeHarness(over: { probe?: null } = {}) {
  let tick: TickFn | null = null;
  const visibilityListeners = new Set<() => void>();
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: "visibilitychange", cb: () => void) => {
      visibilityListeners.add(cb);
    },
    removeEventListener: (_t: "visibilitychange", cb: () => void) => {
      visibilityListeners.delete(cb);
    },
  };
  let current: { id: string; vrma_path: string } | null = {
    id: "idle",
    vrma_path: "/motions/calm.vrma",
  };
  const motions: Array<RenderMotionSignal | null> = [];
  const positions: Array<{ x: number; y: number }> = [];
  const win = {
    outerPosition: vi.fn(async () => ({ x: 1000, y: 600 })),
    setPositionPhysical: vi.fn(async (x: number, y: number) => {
      positions.push({ x, y });
    }),
  };
  const deps: SitterDeps = {
    renderer: {
      onTick: (fn) => {
        tick = fn;
        return () => {
          tick = null;
        };
      },
      playMotion: (m) => {
        motions.push(m);
        current = m ? { id: m.id, vrma_path: `/motions/${m.id}.vrma` } : null;
      },
      getCurrentMotion: () => current,
      getCharacterAnchor: () => ANCHOR,
      getPerchProbe: () => (over.probe === null ? null : { seatPx: SEAT, charHpx: 500 }),
    },
    doc,
  };
  const sitter = createSitter(deps);
  let elapsed = 0;
  /** Advance the render tick by `ms` (a binary-exact fraction of a second), then let promises settle. */
  const frame = async (ms: number): Promise<void> => {
    elapsed += ms / 1000;
    tick?.({ vrm: {} as never, dt: ms / 1000, elapsed } as TickContext);
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  return {
    sitter,
    win,
    motions,
    positions,
    frame,
    flush,
    setCurrent: (id: string) => {
      current = { id, vrma_path: `/motions/${id}.vrma` };
    },
    hide: () => {
      doc.visibilityState = "hidden";
      for (const cb of visibilityListeners) cb();
    },
  };
}

async function outcome(p: Promise<"done" | "lost">): Promise<"done" | "lost" | "pending"> {
  return Promise.race([p, Promise.resolve().then(() => "pending" as const)]);
}

describe("createSitter", () => {
  it("crossfades to window_sit while the window eases down the seat height over 500 ms", async () => {
    const h = makeHarness();
    h.sitter.start();
    // Seat 120 px above the feet at scale 2: the window has 240 physical px to sink.
    const done = h.sitter.sitDown({ win: h.win, scale: 2 });
    await h.flush();
    expect(h.motions).toEqual([SIT]);
    await h.frame(125);
    // Ease-in: 600 + 240 * 0.15625 rounded, short of the linear quarter at 660.
    expect(h.positions.at(-1)).toEqual({ x: 1000, y: 638 });
    await h.frame(125);
    expect(h.positions.at(-1)).toEqual({ x: 1000, y: 720 });
    expect(await outcome(done)).toBe("pending");
    await h.frame(125);
    await h.frame(125);
    expect(h.positions.at(-1)).toEqual({ x: 1000, y: 840 });
    expect(await outcome(done)).toBe("done");
  });

  it.each([
    { name: "no window", probe: undefined, target: null },
    { name: "a body the renderer cannot measure", probe: null, target: "win" },
  ])("crossfades to window_sit in place for $name", async ({ probe, target }) => {
    const h = makeHarness({ probe });
    h.sitter.start();
    const done = h.sitter.sitDown(target ? { win: h.win, scale: 1 } : null);
    await h.flush();
    expect(h.motions).toEqual([SIT]);
    await h.frame(375);
    expect(await outcome(done)).toBe("pending");
    await h.frame(125);
    expect(await outcome(done)).toBe("done");
    expect(h.positions).toEqual([]);
  });

  it("stands up by easing the window to the standing origin over 500 ms", async () => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.standUp(h.win, 400);
    await h.flush();
    expect(h.motions).toEqual([null]);
    await h.frame(250);
    expect(h.positions.at(-1)).toEqual({ x: 1000, y: 500 });
    expect(await outcome(done)).toBe("pending");
    await h.frame(250);
    expect(h.positions.at(-1)).toEqual({ x: 1000, y: 400 });
    expect(await outcome(done)).toBe("done");
  });

  it.each([
    {
      name: "sits",
      run: (h: ReturnType<typeof makeHarness>) => h.sitter.sitDown({ win: h.win, scale: 2 }),
      y: 840,
    },
    {
      name: "stands",
      run: (h: ReturnType<typeof makeHarness>) => h.sitter.standUp(h.win, 400),
      y: 400,
    },
  ])("$name at once when the document is already hidden", async ({ run, y }) => {
    const h = makeHarness();
    h.sitter.start();
    h.hide();
    const done = run(h);
    await h.flush();
    expect(await outcome(done)).toBe("done");
    expect(h.positions).toEqual([{ x: 1000, y }]);
  });

  it.each([
    { name: "cancel", end: (h: ReturnType<typeof makeHarness>) => h.sitter.cancel() },
    { name: "stop", end: (h: ReturnType<typeof makeHarness>) => h.sitter.stop() },
    { name: "the document hiding", end: (h: ReturnType<typeof makeHarness>) => h.hide() },
    {
      name: "a new transition",
      end: (h: ReturnType<typeof makeHarness>) => void h.sitter.sitDown(null),
    },
  ])("ends a running sit as lost on $name, stops the window and hands the body back", async ({
    end,
  }) => {
    const h = makeHarness();
    h.sitter.start();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.flush();
    await h.frame(125);
    const moved = h.positions.length;
    end(h);
    expect(await outcome(done)).toBe("lost");
    expect(h.motions.slice(0, 2)).toEqual([SIT, null]);
    await h.frame(125);
    expect(h.positions.length).toBe(moved);
  });

  it("stops listening to the document once stopped", async () => {
    const h = makeHarness();
    h.sitter.start();
    h.sitter.stop();
    const done = h.sitter.sitDown({ win: h.win, scale: 1 });
    await h.flush();
    h.hide();
    expect(await outcome(done)).toBe("pending");
  });

  it.each([
    {
      name: "sitDown",
      begin: (h: ReturnType<typeof makeHarness>) => h.sitter.sitDown({ win: h.win, scale: 1 }),
    },
    { name: "standUp", begin: (h: ReturnType<typeof makeHarness>) => h.sitter.standUp(h.win, 400) },
  ])("loses $name cancelled while it reads the window position and plays nothing", async ({
    begin,
  }) => {
    const h = makeHarness();
    h.sitter.start();
    const done = begin(h);
    h.sitter.cancel();
    await h.flush();
    expect(await outcome(done)).toBe("lost");
    expect(h.motions).toEqual([]);
  });

  it.each([
    {
      name: "a sit while an emote is current",
      begin: (h: ReturnType<typeof makeHarness>) => h.sitter.sitDown({ win: h.win, scale: 1 }),
      current: "happy",
    },
    {
      name: "a stand-up while window_sit is current",
      begin: (h: ReturnType<typeof makeHarness>) => h.sitter.standUp(h.win, 400),
      current: "window_sit",
    },
  ])("plays nothing when $name is cancelled", async ({ begin, current }) => {
    const h = makeHarness();
    h.sitter.start();
    const done = begin(h);
    await h.flush();
    h.setCurrent(current);
    const played = h.motions.length;
    h.sitter.cancel();
    expect(await outcome(done)).toBe("lost");
    expect(h.motions.length).toBe(played);
  });
});
