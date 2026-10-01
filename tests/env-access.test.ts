/**
 * env-access.test.ts — a build inlines `import.meta.env` as one object when it is read whole,
 * carrying every VITE_* value (keys included) into the bundle. Source reads it property by
 * property so only the named, intended values are inlined.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

describe("import.meta.env access", () => {
  it("is never read as a whole object in src", () => {
    const wholeObject = /import\.meta\.env(?!\s*\??\.[A-Za-z_$])/;
    const offenders = sourceFiles(SRC).filter((f) => wholeObject.test(readFileSync(f, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
