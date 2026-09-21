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
const COMMAND = /[MmZzLlHhVvCcSsQqTtAa][^MmZzLlHhVvCcSsQqTtAa]*/g;
const NUMBER = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
/** Literal path data only: a `d` built at render time is not readable from the source. */
const INLINE_PATH = /<path[^>]*\sd="([^"]*)"/g;

/**
 * Commands whose argument count does not match what they take. Arc flags are read as
 * ordinary numbers, so the compact `a1 1 0 011 1` spelling would miscount.
 */
function malformedCommands(d: string): string[] {
  const bad: string[] = [];
  for (const command of d.match(COMMAND) ?? []) {
    const takes = ARGS[command[0]];
    const given = (command.slice(1).match(NUMBER) ?? []).length;
    if (takes === 0 ? given !== 0 : given === 0 || given % takes !== 0) bad.push(command.trim());
  }
  return bad;
}

describe("inline icon paths", () => {
  it("reads argument counts off a path, exponents and all", () => {
    expect(malformedCommands("M5 6h14a1 1 0 0 1 1 1v9z")).toEqual([]);
    expect(malformedCommands("M1e2 3L-.5.5 2 3")).toEqual([]);
    // One argument too many for an arc: the icon this check was written for.
    expect(malformedCommands("M5 6v9a1 1 1 0 0 1-1 1z")).toEqual(["a1 1 1 0 0 1-1 1"]);
  });

  it("gives every path command in src/ui the arguments it takes", () => {
    const malformed: string[] = [];
    let paths = 0;
    for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|html)$/.test(entry.name)) continue;
      const file = `${entry.parentPath}/${entry.name}`;
      for (const [, d] of readFileSync(file, "utf8").matchAll(INLINE_PATH)) {
        // A `d` assembled at render time holds no readable path data.
        if (d.includes("${")) continue;
        paths += 1;
        for (const command of malformedCommands(d)) {
          malformed.push(`${relative(SRC, file)}: ${command}`);
        }
      }
    }
    expect(paths).toBeGreaterThan(50);
    expect(malformed).toEqual([]);
  });
});
