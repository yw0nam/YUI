/**
 * motion-fallback.test.ts — renderer idle-fallback seam.
 *
 * When a motion clip fails to load, the renderer must repair controller state by
 * force-committing idle (bypassing request() priority) and re-playing it, so a
 * failed motion never leaves `current`/`previousStable` pinned at the dead id and
 * never blocks a later lower-priority idle.
 *
 * createRenderer instantiates a real THREE.WebGLRenderer (no GL context in
 * node/jsdom), so the fallback decision is verified at its observable seam:
 * resolveBaselineFallback drives controller.resolve("idle") → force-commit, and
 * the renderer then calls startMotion on the returned motion. These tests model
 * exactly that wiring against the real motion-controller + real configs/motions.json.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { MotionRegistry } from "../contract";
import { createMotionController } from "./motion-controller";
import { createDeadClipRegistry, resolveBaselineFallback } from "./motion-fallback";

const realRegistry: MotionRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "configs/motions.json"), "utf-8"),
);

describe("resolveBaselineFallback — failed clip repairs controller to idle", () => {
  it("a failed kind:state motion (thinking) is overwritten by force-committed idle", () => {
    const controller = createMotionController(realRegistry, { rng: () => 0 });

    // Simulate playMotion having committed thinking *before* its async clip load failed:
    // current + previousStable are now pinned at the dead state motion.
    const thinking = controller.resolve({ id: "thinking" });
    expect(thinking).not.toBeNull();
    controller.commit({ action: "play", motion: thinking! });
    expect(controller.current()?.id).toBe("thinking");

    // Clip load failed → fallback. Returns the idle motion to (re)play.
    const idle = resolveBaselineFallback(controller, "thinking");
    expect(idle).not.toBeNull();
    expect(idle!.id).toBe("idle");

    // Force-commit overwrote both current and previousStable with idle (ambient).
    expect(controller.current()?.id).toBe("idle");
  });

  it("force-committed idle repairs previousStable so a later oneshot returns to idle, not the dead motion", () => {
    const controller = createMotionController(realRegistry, { rng: () => 0 });

    const thinking = controller.resolve({ id: "thinking" })!;
    controller.commit({ action: "play", motion: thinking });

    resolveBaselineFallback(controller, "thinking");

    // Play a oneshot then finish it — it must return to idle (previousStable), not thinking.
    const happy = controller.resolve({ id: "happy" })!;
    controller.commit({ action: "play", motion: happy });
    const next = controller.finish("happy");
    expect(next.action).toBe("play");
    expect(next.action === "play" && next.motion.id).toBe("idle");
  });

  it("idle's own load failure does NOT recurse (returns null)", () => {
    const controller = createMotionController(realRegistry, { rng: () => 0 });
    const idle = controller.resolve({ id: "idle" })!;
    controller.commit({ action: "play", motion: idle });

    expect(resolveBaselineFallback(controller, "idle")).toBeNull();
    // current is untouched — no force-commit, no recursion.
    expect(controller.current()?.id).toBe("idle");
  });

  it("returns null when idle is not registered (no force-commit possible)", () => {
    const noIdle: MotionRegistry = {
      drag: realRegistry.drag,
    };
    const controller = createMotionController(noIdle);
    expect(resolveBaselineFallback(controller, "drag")).toBeNull();
  });

  it("recursion guard tracks the controller's configured baseline, not a hardcoded 'idle'", () => {
    // baseline is 'window_sit' here; a failed 'window_sit' clip must NOT recurse,
    // while a failed 'idle' clip SHOULD fall back to the window_sit baseline.
    const controller = createMotionController(realRegistry, {
      rng: () => 0,
      baselineId: "window_sit",
    });

    expect(resolveBaselineFallback(controller, "window_sit")).toBeNull();

    const baseline = resolveBaselineFallback(controller, "idle");
    expect(baseline).not.toBeNull();
    expect(baseline!.id).toBe("window_sit");
  });
});

describe("createDeadClipRegistry — a permanently missing VRMA is warned once and never refetched", () => {
  function makeLog() {
    return { warn: vi.fn() };
  }

  it("starts with no path marked dead", () => {
    const reg = createDeadClipRegistry(makeLog());
    expect(reg.isDead("/purchased_motions/thinking.vrma")).toBe(false);
  });

  it("markDead warns once with the path and the error, then isDead is true", () => {
    const log = makeLog();
    const reg = createDeadClipRegistry(log);

    reg.markDead(
      "/purchased_motions/thinking.vrma",
      new Error("JSON Parse error: Unrecognized token '<'"),
    );

    expect(reg.isDead("/purchased_motions/thinking.vrma")).toBe(true);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("vrma_load_failed", {
      vrma_path: "/purchased_motions/thinking.vrma",
      error: expect.stringContaining("Unrecognized token"),
    });
  });

  it("marking the same path again does not warn again (no per-turn log spam)", () => {
    const log = makeLog();
    const reg = createDeadClipRegistry(log);

    reg.markDead("/purchased_motions/thinking.vrma", new Error("boom"));
    reg.markDead("/purchased_motions/thinking.vrma", new Error("boom"));

    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("tracks paths independently", () => {
    const reg = createDeadClipRegistry(makeLog());
    reg.markDead("/purchased_motions/thinking.vrma", new Error("boom"));
    expect(reg.isDead("/motions/calm.vrma")).toBe(false);
  });
});
