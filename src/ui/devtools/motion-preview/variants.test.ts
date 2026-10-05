import { describe, expect, it } from "vitest";
import type { MotionRegistry } from "../../../contract";
import { expandVariantEntries } from "./variants";

const idle = {
  vrma_path: "/motions/idle_01.vrma",
  variants: ["/motions/idle_01.vrma", "/motions/idle_02.vrma"],
  variant_policy: "random",
  loop_cycles: [1, 2],
  cycle_dwell_ms: 300,
  kind: "ambient",
  loop: true,
  priority: 10,
  interrupt_policy: "replace",
} satisfies MotionRegistry[string];
const wave = {
  vrma_path: "/motions/wave.vrma",
  kind: "oneshot",
  loop: false,
  priority: 50,
  interrupt_policy: "replace",
} satisfies MotionRegistry[string];

describe("expandVariantEntries", () => {
  it("inserts one single-clip entry per variant right after its pool, without the pool-only fields", () => {
    const { registry, variantIds } = expandVariantEntries({ idle, wave });
    expect(Object.keys(registry)).toEqual(["idle", "idle_01", "idle_02", "wave"]);
    expect(registry.idle).toBe(idle);
    expect(registry.idle_02).toEqual({
      vrma_path: "/motions/idle_02.vrma",
      kind: "ambient",
      loop: true,
      priority: 10,
      interrupt_policy: "replace",
    });
    expect([...variantIds]).toEqual(["idle_01", "idle_02"]);
  });

  it("skips a variant whose id already names a registry entry", () => {
    const { registry, variantIds } = expandVariantEntries({
      idle: { ...idle, variants: ["/motions/wave.vrma"] },
      wave,
    });
    expect(registry.wave).toBe(wave);
    expect(variantIds.size).toBe(0);
  });
});
