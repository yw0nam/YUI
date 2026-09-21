import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Icons are hand-written inline SVG. A command given the wrong number of arguments makes
// the path data invalid from that point on, and the renderer draws only what came before —
// jsdom keeps `d` as a string, so no rendering test can see it.
const SRC = fileURLToPath(new URL("..", import.meta.url));

/** Arguments each path command takes, repeated for every further argument set. */
const ARGS: Record<string, number> = {
  M: 2,
  m: 2,
  L: 2,
  l: 2,
  H: 1,
  h: 1,
  V: 1,
  v: 1,
  C: 6,
  c: 6,
  S: 4,
  s: 4,
  Q: 4,
  q: 4,
  T: 2,
  t: 2,
  A: 7,
  a: 7,
  Z: 0,
  z: 0,
};
/** Literal path data only: a `d` built at render time is not readable from the source. */
const INLINE_PATH = /<path[^>]*\sd="([MmZzLlHhVvCcSsQqTtAa][^"]*)"/g;

function malformedCommands(d: string): string[] {
  const bad: string[] = [];
  for (const command of d.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const takes = ARGS[command[0]];
    // Arc flags carry their own separator here; the compact `0 011 1` form would miscount.
    const given = (command.slice(1).match(/-?\d*\.?\d+/g) ?? []).length;
    const ok =
      takes === undefined ? false : takes === 0 ? given === 0 : given > 0 && given % takes === 0;
    if (!ok) bad.push(command.trim());
  }
  return bad;
}

describe("inline icon paths", () => {
  it("give every path command the arguments it takes", () => {
    const malformed: string[] = [];
    let paths = 0;
    for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const file = `${entry.parentPath}/${entry.name}`;
      for (const [, d] of readFileSync(file, "utf8").matchAll(INLINE_PATH)) {
        paths += 1;
        for (const command of malformedCommands(d)) {
          malformed.push(`${relative(SRC, file)}: ${command}`);
        }
      }
    }
    expect(paths).toBeGreaterThan(0);
    expect(malformed).toEqual([]);
  });
});
