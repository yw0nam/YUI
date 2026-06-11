/**
 * motion-preemption.test.ts — TDD red phase (Unit U0): motion-preemption primitive.
 *
 * createRenderer needs a real WebGL context, so the preemption primitive lives in a
 * pure tracker (this module) that the renderer wires into its play/dispose sinks. The
 * tracker is tested directly here, mirroring exactly how index.ts drives it:
 *
 *  - playMotion (the single decision sink, index.ts:716): when controller.request
 *      returns action:"play" and the prior active motion id differs from the incoming,
 *      the renderer calls preempt(prevId, nextId) — fires once per supersession. This is
 *      the priority path (motion-controller.ts:214) AND the replace-policy path (:220).
 *  - dispose()/teardownMotion (index.ts:914/457): the renderer calls preempt(prevId, null)
 *      so an in-flight fall sequence learns its motion is gone.
 *  - generation(): a monotonic counter (mirrors pollGen in window-drop-source.ts:115)
 *      bumped on every preemption + dispose, so a captured-then-stale gen is detectable.
 */

import { describe, it, expect, vi } from "vitest";
import { createMotionPreemption } from "./motion-preemption";

describe("motion-preemption — preempt fires subscribers with (prevId, nextId)", () => {
  it("a higher-priority motion replacing the active one fires the callback", () => {
    const pre = createMotionPreemption();
    const cb = vi.fn();
    pre.onMotionPreempted(cb);

    // falling (p78) is active; drag (p80) supersedes it via the priority path.
    pre.preempt("falling", "drag");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ prevId: "falling", nextId: "drag" });
  });

  it("a same-or-lower-priority replace-policy motion replacing the active one fires", () => {
    const pre = createMotionPreemption();
    const cb = vi.fn();
    pre.onMotionPreempted(cb);

    // low_replace (p10, policy=replace) supersedes a higher-priority active motion.
    pre.preempt("falling", "low_replace");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ prevId: "falling", nextId: "low_replace" });
  });

  it("dispose fires the callback with nextId=null (motion is gone)", () => {
    const pre = createMotionPreemption();
    const cb = vi.fn();
    pre.onMotionPreempted(cb);

    pre.preempt("falling", null);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ prevId: "falling", nextId: null });
  });

  it("fans out to every subscriber", () => {
    const pre = createMotionPreemption();
    const a = vi.fn();
    const b = vi.fn();
    pre.onMotionPreempted(a);
    pre.onMotionPreempted(b);

    pre.preempt("falling", "drag");

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops further deliveries", () => {
    const pre = createMotionPreemption();
    const cb = vi.fn();
    const off = pre.onMotionPreempted(cb);

    pre.preempt("falling", "drag");
    off();
    pre.preempt("drag", "idle");

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not block other subscribers or bump suppression", () => {
    const pre = createMotionPreemption();
    const boom = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    const ok = vi.fn();
    pre.onMotionPreempted(boom);
    pre.onMotionPreempted(ok);

    expect(() => pre.preempt("falling", "drag")).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe("motion-preemption — generation counter detects stale async work", () => {
  it("starts at a stable baseline", () => {
    const pre = createMotionPreemption();
    expect(pre.generation()).toBe(pre.generation());
  });

  it("preempt increments the generation so a captured value becomes stale", () => {
    const pre = createMotionPreemption();

    // Fall controller captures the gen at sequence start.
    const captured = pre.generation();

    // A drag re-grab preempts falling mid-fall.
    pre.preempt("falling", "drag");

    // The captured gen is now stale → the controller drops its in-flight setPosition.
    expect(pre.generation()).not.toBe(captured);
    expect(pre.isCurrent(captured)).toBe(false);
  });

  it("isCurrent is true for the live generation and false after any bump", () => {
    const pre = createMotionPreemption();

    const gen = pre.generation();
    expect(pre.isCurrent(gen)).toBe(true);

    pre.preempt("falling", null); // dispose path bumps too.
    expect(pre.isCurrent(gen)).toBe(false);
  });

  it("increments monotonically across multiple preemptions", () => {
    const pre = createMotionPreemption();

    const g0 = pre.generation();
    pre.preempt("falling", "drag");
    const g1 = pre.generation();
    pre.preempt("drag", "idle");
    const g2 = pre.generation();

    expect(g1).toBeGreaterThan(g0);
    expect(g2).toBeGreaterThan(g1);
  });

  it("the generation bumps before subscribers run, so a callback sees the fresh gen", () => {
    const pre = createMotionPreemption();
    const captured = pre.generation();
    let seenInsideCb = -1;
    pre.onMotionPreempted(() => {
      seenInsideCb = pre.generation();
    });

    pre.preempt("falling", "drag");

    expect(seenInsideCb).not.toBe(captured);
    expect(pre.isCurrent(seenInsideCb)).toBe(true);
  });
});
