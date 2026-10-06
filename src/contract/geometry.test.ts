/**
 * geometry.test.ts — locks the shape of client-only window-sit perch types (ScreenRect/WindowRect).
 * Compile-time checks (pnpm build) are the primary gate, but this test fixes the value-level assertion that
 * WindowRect extends ScreenRect.
 *
 * Also marks that these types are outside the backend contract (excluded from generate_express/ControlEnvelope).
 */

import { describe, expect, expectTypeOf, it } from "vitest";
import type { ScreenRect, WindowRect } from "./types";

describe("ScreenRect", () => {
  it("carries x/y/width/height as points", () => {
    const rect: ScreenRect = { x: 10, y: 20, width: 800, height: 600 };
    expect(rect.x + rect.width).toBe(810);
    expectTypeOf<ScreenRect["height"]>().toEqualTypeOf<number>();
  });
});

describe("WindowRect", () => {
  it("extends ScreenRect, adding name(null allowed)·pid·windowNumber", () => {
    const win: WindowRect = {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      name: "Safari",
      ownerName: "Safari",
      pid: 4242,
      windowNumber: 88,
    };
    const asRect: ScreenRect = win;
    expect(asRect.width).toBe(1280);
    expect(win.pid).toBe(4242);
    expect(win.windowNumber).toBe(88);
    expectTypeOf<WindowRect["name"]>().toEqualTypeOf<string | null>();
  });

  it("name can be null", () => {
    const win: WindowRect = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      name: null,
      ownerName: null,
      pid: 1,
      windowNumber: 1,
    };
    expect(win.name).toBeNull();
  });
});
