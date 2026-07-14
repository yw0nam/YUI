/**
 * load-motions.test.ts — loadConfig motions.* 섹션 단위 테스트.
 * variants/variant_policy, cycle_dwell_ms, pingpong·loop_cycles, fade_ms.
 */

import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./load";
import { goodFixture, readerOf } from "./load-test-helpers";

// ── motions.variants / variant_policy (D-MOTION-VARIANTS) ───────────────────────

describe("loadConfig — motions.variants", () => {
  it("variants/variant_policy를 검증 후 그대로 보존한다", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      idle: {
        vrma_path: "/motions/a.vrma",
        variants: ["/motions/a.vrma", "/motions/b.vrma"],
        variant_policy: "random",
        kind: "ambient",
        loop: true,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.motions.idle.variants).toEqual(["/motions/a.vrma", "/motions/b.vrma"]);
    expect(cfg.motions.idle.variant_policy).toBe("random");
  });

  it("variants 없는 항목은 통과하고 variants는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.motions.idle.variants).toBeUndefined();
    expect(cfg.motions.idle.variant_policy).toBeUndefined();
  });

  it("broker_publish:false를 검증 후 그대로 보존한다", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      idle: {
        vrma_path: "/motions/a.vrma",
        broker_publish: false,
        kind: "oneshot",
        loop: false,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.motions.idle.broker_publish).toBe(false);
  });

  it("broker_publish 없는 항목은 통과하고 broker_publish는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.motions.idle.broker_publish).toBeUndefined();
  });

  it("reactive 루프 + broker_publish:false 항목(falling)을 그대로 보존한다", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      falling: {
        vrma_path: "/motions/falling_loop.vrma",
        kind: "reactive",
        loop: true,
        priority: 78,
        interrupt_policy: "replace",
        broker_publish: false,
      },
    };
    const cfg = await loadConfig({ read: readerOf(map) });
    expect(cfg.motions.falling.kind).toBe("reactive");
    expect(cfg.motions.falling.loop).toBe(true);
    expect(cfg.motions.falling.broker_publish).toBe(false);
    expect(cfg.motions.falling.vrma_path).toBe("/motions/falling_loop.vrma");
  });
});

// ── motions.cycle_dwell_ms (cycle 정착 프레임 유지) ──────────────────────────────

/** cycle 모션 한 항목(variants>1 + loop:true)을 motions.json으로 깔아주는 fixture. */
function cycleMotionFixture(dwell?: number): Record<string, unknown> {
  const map = goodFixture();
  map["motions.json"] = {
    perch: {
      vrma_path: "/motions/a.vrma",
      variants: ["/motions/a.vrma", "/motions/b.vrma"],
      variant_policy: "random",
      ...(dwell !== undefined ? { cycle_dwell_ms: dwell } : {}),
      kind: "state",
      loop: true,
      priority: 50,
      interrupt_policy: "replace",
    },
  };
  return map;
}

describe("loadConfig — motions.cycle_dwell_ms", () => {
  it("유효한 cycle_dwell_ms를 검증 후 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(cycleMotionFixture(4000)) });
    expect(cfg.motions.perch.cycle_dwell_ms).toBe(4000);
  });

  it("cycle_dwell_ms 없는 항목은 통과하고 cycle_dwell_ms는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(cycleMotionFixture()) });
    expect(cfg.motions.perch.cycle_dwell_ms).toBeUndefined();
  });

  it("정수가 아니면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(cycleMotionFixture(1000.5)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("음수면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(cycleMotionFixture(-1)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("60000 초과면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(cycleMotionFixture(60001)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("cycle 모션(variants>1 + loop)이 아닌데 cycle_dwell_ms가 있으면 ConfigError", async () => {
    const map = goodFixture();
    map["motions.json"] = {
      idle: {
        vrma_path: "/motions/a.vrma",
        cycle_dwell_ms: 4000,
        kind: "ambient",
        loop: false,
        priority: 0,
        interrupt_policy: "replace",
      },
    };
    await expect(loadConfig({ read: readerOf(map) })).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── motions.pingpong / loop_cycles (ping-pong loop) ─────────────────────────────

/** multi-variant loop 항목에 pingpong/loop_cycles를 깔아주는 fixture. */
function pingpongMotionFixture(over: Record<string, unknown>): Record<string, unknown> {
  const map = goodFixture();
  map["motions.json"] = {
    idle: {
      vrma_path: "/motions/a.vrma",
      variants: ["/motions/a.vrma", "/motions/b.vrma"],
      variant_policy: "random",
      kind: "ambient",
      loop: true,
      priority: 0,
      interrupt_policy: "replace",
      ...over,
    },
  };
  return map;
}

describe("loadConfig — motions.pingpong / loop_cycles", () => {
  it("유효한 pingpong:true + loop_cycles:[1,3]을 검증 후 그대로 보존한다", async () => {
    const cfg = await loadConfig({
      read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [1, 3] })),
    });
    expect(cfg.motions.idle.pingpong).toBe(true);
    expect(cfg.motions.idle.loop_cycles).toEqual([1, 3]);
  });

  it("pingpong/loop_cycles 없는 항목은 통과하고 둘 다 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(goodFixture()) });
    expect(cfg.motions.idle.pingpong).toBeUndefined();
    expect(cfg.motions.idle.loop_cycles).toBeUndefined();
  });

  it("pingpong이 boolean이 아니면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ pingpong: "yes" })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("pingpong:true + loop:false면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ pingpong: true, loop: false })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("pingpong:true + crossfade_loop:true면 ConfigError(상호 배타)", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, crossfade_loop: true })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles가 pingpong:true 없이 있으면 ConfigError(dead 필드)", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ loop_cycles: [1, 3] })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles가 2-요소가 아니면 ConfigError", async () => {
    await expect(
      loadConfig({ read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [1] })) }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles의 lo>hi면 ConfigError", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [3, 1] })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles에 0이 있으면 ConfigError(양의 정수)", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [0, 2] })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  it("loop_cycles에 정수가 아닌 값이 있으면 ConfigError", async () => {
    await expect(
      loadConfig({
        read: readerOf(pingpongMotionFixture({ pingpong: true, loop_cycles: [1, 2.5] })),
      }),
    ).rejects.toBeInstanceOf(ConfigError);
  });
});

// ── motions.fade_ms (entry-level default crossfade) ─────────────────────────────

/** 한 모션 항목에 fade_ms를 깔아주는 fixture. */
function fadeMotionFixture(fade?: number): Record<string, unknown> {
  const map = goodFixture();
  map["motions.json"] = {
    perch: {
      vrma_path: "/motions/a.vrma",
      ...(fade !== undefined ? { fade_ms: fade } : {}),
      kind: "state",
      loop: true,
      priority: 50,
      interrupt_policy: "replace",
    },
  };
  return map;
}

describe("loadConfig — motions.fade_ms", () => {
  it("유효한 fade_ms를 검증 후 그대로 보존한다", async () => {
    const cfg = await loadConfig({ read: readerOf(fadeMotionFixture(700)) });
    expect(cfg.motions.perch.fade_ms).toBe(700);
  });

  it("fade_ms 없는 항목은 통과하고 fade_ms는 undefined", async () => {
    const cfg = await loadConfig({ read: readerOf(fadeMotionFixture()) });
    expect(cfg.motions.perch.fade_ms).toBeUndefined();
  });

  it("정수가 아니면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(fadeMotionFixture(700.5)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("음수면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(fadeMotionFixture(-1)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });

  it("5000 초과면 ConfigError", async () => {
    await expect(loadConfig({ read: readerOf(fadeMotionFixture(5001)) })).rejects.toBeInstanceOf(
      ConfigError,
    );
  });
});
