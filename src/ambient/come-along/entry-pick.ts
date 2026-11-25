import type { StageConfig } from "../../config/validators/avatar/types";

/**
 * Her entry for `emotion`: the family that lists it, else plain, and one of its clips drawn by
 * `random`, never the family's `last` one while it holds another.
 */
export function pickEntry(
  families: StageConfig["entry_families"],
  emotion: string,
  last: ReadonlyMap<string, string>,
  random: () => number,
): { family: string; clip: string } {
  const family =
    Object.keys(families).find((name) => families[name]?.emotions.includes(emotion)) ?? "plain";
  const { clips } = families[family] ?? families.plain;
  const fresh = clips.filter((clip) => clip !== last.get(family));
  const pool = fresh.length > 0 ? fresh : clips;
  return { family, clip: pool[Math.floor(random() * pool.length)] as string };
}
