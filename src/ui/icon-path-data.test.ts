import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SVGPathData } from "svg-pathdata";
import { describe, expect, it } from "vitest";

// Icons are hand-written inline SVG. Path data that breaks the grammar is invalid from the
// offending command on, and the renderer draws only what came before — jsdom keeps `d` as a
// string, so no rendering test can see it.
const SRC = fileURLToPath(new URL("..", import.meta.url));
/** Literal path data only: a `d` built at render time is not readable from the source. */
const INLINE_PATH = /<path[^>]*\sd="([^"]*)"/g;

function parseError(d: string): string | null {
  try {
    SVGPathData.parse(d);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

describe("inline icon paths", () => {
  it("rejects a command carrying one argument too many", () => {
    // The message icon shipped this: eight numbers where an arc takes seven.
    expect(parseError("M5 6v9a1 1 1 0 0 1-1 1z")).toMatch(/Unterminated command/);
  });

  it("parses every path in src/ui", () => {
    const failures: string[] = [];
    let paths = 0;
    for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !/\.(ts|html)$/.test(entry.name)) continue;
      const file = `${entry.parentPath}/${entry.name}`;
      for (const [, d] of readFileSync(file, "utf8").matchAll(INLINE_PATH)) {
        // A `d` assembled at render time holds no readable path data.
        if (d.includes("${")) continue;
        paths += 1;
        const error = parseError(d);
        if (error) failures.push(`${relative(SRC, file)}: ${error}`);
      }
    }
    expect(paths).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });
});
