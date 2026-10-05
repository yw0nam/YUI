import type { MotionRegistry } from "../../../contract";

/** "/motions/idle_03.vrma" → "idle_03" */
export function variantName(vrmaPath: string): string {
  return vrmaPath.slice(vrmaPath.lastIndexOf("/") + 1).replace(/\.vrma$/, "");
}

/**
 * Preview-only: expand each pooled entry's variants into individually playable
 * single-vrma entries (idle_01, sit_02, …) inserted right after their pool, so a
 * specific variant can be selected directly instead of via the pool's random pick.
 */
export function expandVariantEntries(reg: MotionRegistry): {
  registry: MotionRegistry;
  variantIds: Set<string>;
} {
  const out: MotionRegistry = {};
  const variantIds = new Set<string>();
  for (const [id, entry] of Object.entries(reg)) {
    out[id] = entry;
    if (!entry.variants || entry.variants.length === 0) continue;
    for (const v of entry.variants) {
      const childId = variantName(v);
      if (reg[childId] || out[childId]) continue;
      const {
        variants: _v,
        variant_policy: _p,
        loop_cycles: _l,
        cycle_dwell_ms: _c,
        ...rest
      } = entry;
      out[childId] = { ...rest, vrma_path: v };
      variantIds.add(childId);
    }
  }
  return { registry: out, variantIds };
}
