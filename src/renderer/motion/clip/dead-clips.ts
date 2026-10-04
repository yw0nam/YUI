/**
 * Tracks VRMA paths whose fetch/parse failed for a reason no retry can fix — above all
 * a purchased motion absent from the bundle (gitignored, non-redistributable). The first
 * failure warns with the path; from then on the loader skips the network entirely and
 * the renderer falls straight back to the baseline, so a missing asset costs one warn
 * per session instead of an error per turn.
 */
export function createDeadClipRegistry(log: {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}): {
  isDead: (vrmaPath: string) => boolean;
  markDead: (vrmaPath: string, error: unknown) => void;
} {
  const dead = new Set<string>();
  return {
    isDead: (vrmaPath) => dead.has(vrmaPath),
    markDead(vrmaPath, error) {
      if (dead.has(vrmaPath)) return;
      dead.add(vrmaPath);
      log.warn("vrma_load_failed", { vrma_path: vrmaPath, error: String(error) });
    },
  };
}
