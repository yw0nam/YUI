import type { VRM } from "@pixiv/three-vrm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import { createFrameLoop } from "./frame-loop";
import type { TickFn } from "./types";
import type { VrmParticipant } from "./vrm-participant";

const FRAME_MS = 1000 / 60;

interface Harness {
  order: string[];
  loop: ReturnType<typeof createFrameLoop>;
  hooks: Set<TickFn>;
  dts: number[];
  log: Logger;
  setConverging(on: boolean): void;
  setVisibility(state: "visible" | "hidden"): void;
}

function setup(): Harness {
  const order: string[] = [];
  const dts: number[] = [];
  let converging = false;
  let visibility: "visible" | "hidden" = "visible";
  const listeners = new Set<() => void>();
  vi.stubGlobal("document", {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  });
  const vrm = {
    update: (dt: number) => {
      order.push("vrm.update");
      dts.push(dt);
    },
    springBoneManager: { reset: () => order.push("spring.reset") },
  } as unknown as VRM;
  const participants: VrmParticipant[] = [
    { step: () => order.push("participant"), isConverging: () => converging },
  ];
  const hooks = new Set<TickFn>();
  const log = { error: vi.fn() } as unknown as Logger;
  const loop = createFrameLoop({
    participants,
    motion: { isConverging: () => false, step: () => order.push("motion") },
    rig: { isConverging: () => false, step: () => order.push("rig") },
    rootYaw: { isConverging: () => false, step: () => order.push("rootYaw") },
    tickHooks: hooks,
    getVrm: () => vrm,
    render: () => order.push("render"),
    log,
  });
  return {
    order,
    loop,
    hooks,
    dts,
    log,
    setConverging: (on) => {
      converging = on;
    },
    setVisibility: (state) => {
      visibility = state;
      for (const fn of listeners) fn();
    },
  };
}

describe("createFrameLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, FRAME_MS));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("steps rig, hooks, motion, root yaw, participants, vrm.update, then renders", () => {
    const h = setup();
    h.hooks.add(() => h.order.push("hook"));
    h.loop.start();
    expect(h.order).toEqual([
      "rig",
      "hook",
      "motion",
      "rootYaw",
      "participant",
      "vrm.update",
      "render",
    ]);
    h.loop.dispose();
  });

  it("resets the spring bones after vrm.update while held, until the VRM is disposed", () => {
    const h = setup();
    h.setConverging(true);
    h.loop.setSpringBonesHeld(true);
    h.loop.start();
    vi.advanceTimersByTime(FRAME_MS);
    expect(h.order.slice(-3)).toEqual(["vrm.update", "spring.reset", "render"]);
    expect(h.order.filter((e) => e === "spring.reset")).toHaveLength(2);

    h.loop.onVrmDisposed();
    h.order.length = 0;
    vi.advanceTimersByTime(FRAME_MS);
    expect(h.order).toContain("vrm.update");
    expect(h.order).not.toContain("spring.reset");
    h.loop.dispose();
  });

  it("keeps the frame going when a tick hook throws", () => {
    const h = setup();
    h.hooks.add(() => {
      throw new Error("boom");
    });
    h.loop.start();
    expect(h.log.error).toHaveBeenCalledWith("tick_hook_error", { error: "Error: boom" });
    expect(h.order).toContain("vrm.update");
    expect(h.order.at(-1)).toBe("render");
    h.loop.dispose();
  });

  it("pauses while hidden and resumes without a time jump", () => {
    const h = setup();
    h.setConverging(true);
    h.loop.start();
    vi.advanceTimersByTime(FRAME_MS);
    h.setVisibility("hidden");
    h.order.length = 0;
    vi.advanceTimersByTime(60_000);
    expect(h.order).toEqual([]);

    h.setVisibility("visible");
    expect(h.order).toContain("render");
    vi.advanceTimersByTime(FRAME_MS);
    for (const dt of h.dts.slice(-2)) expect(dt).toBeLessThan(0.1);
    h.loop.dispose();
  });

  it("skips idle frames past the 30fps cap and renders every frame when disabled", () => {
    const h = setup();
    h.loop.start();
    vi.advanceTimersByTime(FRAME_MS * 6);
    const throttled = h.order.filter((e) => e === "render").length;
    expect(throttled).toBeLessThan(5);

    h.loop.setIdleThrottleEnabled(false);
    h.order.length = 0;
    vi.advanceTimersByTime(FRAME_MS * 6);
    expect(h.order.filter((e) => e === "render").length).toBeGreaterThanOrEqual(5);
    h.loop.dispose();
  });
});
