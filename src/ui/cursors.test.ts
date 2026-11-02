// Every stylesheet's cursor is one WebKit 26.2 shows: it leaves the previous cursor for these keywords
// (WebKit bug 303845, measured in #1777), so a stylesheet draws an image cursor first or picks another.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

const UNSHOWN = new Set([
  "ew-resize",
  "ns-resize",
  "nwse-resize",
  "nesw-resize",
  "e-resize",
  "move",
  "help",
]);

function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return cssFilesUnder(path);
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

it("sets no cursor WebKit 26.2 does not show", () => {
  const unshown = cssFilesUnder("src").flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/cursor:\s*([^;]+);/g)]
      .map((m) => m[1]!.trim())
      .filter((value) => !value.startsWith("url(") && UNSHOWN.has(value))
      .map((value) => `${file}: ${value}`),
  );
  expect(unshown).toEqual([]);
});
