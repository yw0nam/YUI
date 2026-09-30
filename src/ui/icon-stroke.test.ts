import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The line-icon look rides on two strokes only, chosen by rendered size:
// 1.5 at 0.9rem or larger, 2 below it where a 24-viewBox glyph needs the heavier line.
const SRC = fileURLToPath(new URL("..", import.meta.url));
const STROKE_ATTR = /stroke-width\s*=\s*"([^"]+)"/g;

describe("icon stroke widths", () => {
  it("uses only 1.5 or 2 across src/ui", () => {
    const failures: string[] = [];
    let attrs = 0;
    for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts"))
        continue;
      const file = `${entry.parentPath}/${entry.name}`;
      for (const [, value] of readFileSync(file, "utf8").matchAll(STROKE_ATTR)) {
        attrs += 1;
        if (value !== "1.5" && value !== "2") failures.push(`${relative(SRC, file)}: ${value}`);
      }
    }
    expect(attrs).toBeGreaterThan(50);
    expect(failures).toEqual([]);
  });
});
