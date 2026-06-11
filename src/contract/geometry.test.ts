/**
 * geometry.test.ts — client-only window-sit perch 타입(ScreenRect/WindowRect/PerchTarget)의
 * 모양을 굳힌다. 컴파일 타임 검사(pnpm build)가 1차 게이트지만, 여기서 WindowRect가
 * ScreenRect를 확장하는지와 PerchTarget.edge가 리터럴 union인지를 값으로 고정한다.
 *
 * 이 타입들은 backend contract 밖(generate_express/ControlEnvelope 미포함)임을 함께 표시한다.
 */

import { describe, it, expect, expectTypeOf } from "vitest";
import type { ScreenRect, WindowRect, PerchTarget } from "./types";

describe("ScreenRect", () => {
  it("x/y/width/height를 points로 담는다", () => {
    const rect: ScreenRect = { x: 10, y: 20, width: 800, height: 600 };
    expect(rect.x + rect.width).toBe(810);
    expectTypeOf<ScreenRect["height"]>().toEqualTypeOf<number>();
  });
});

describe("WindowRect", () => {
  it("ScreenRect를 확장하고 name(null 허용)·pid·windowNumber를 더한다", () => {
    const win: WindowRect = {
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      name: "Safari",
      pid: 4242,
      windowNumber: 88,
    };
    const asRect: ScreenRect = win;
    expect(asRect.width).toBe(1280);
    expect(win.pid).toBe(4242);
    expect(win.windowNumber).toBe(88);
    expectTypeOf<WindowRect["name"]>().toEqualTypeOf<string | null>();
  });

  it("name은 null일 수 있다", () => {
    const win: WindowRect = {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      name: null,
      pid: 1,
      windowNumber: 1,
    };
    expect(win.name).toBeNull();
  });
});

describe("PerchTarget", () => {
  it('rect + edge("top") 리터럴 union을 담는다', () => {
    const target: PerchTarget = {
      rect: { x: 0, y: 0, width: 400, height: 300 },
      edge: "top",
    };
    expect(target.edge).toBe("top");
    expectTypeOf<PerchTarget["edge"]>().toEqualTypeOf<"top">();
  });
});
