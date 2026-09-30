// tokens.test.ts — redesign-foundation token contract: the bundled Pretendard JP
// font, the type/radius/panel-surface tokens, and the dark-only color scheme.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TOKENS = ["src/ui/tokens.css", "src/styles.css"].map((p) => readFileSync(p, "utf8"));
const tokensCss = TOKENS[0];
const stylesCss = TOKENS[1];

function cssFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return path === join("src", "ui", "mocks") ? [] : cssFilesUnder(path);
    }
    return entry.name.endsWith(".css") ? [path] : [];
  });
}

describe("redesign foundation tokens", () => {
  it("declares the font, type-scale, shape, panel-surface, and control tokens", () => {
    for (const name of [
      "--yui-font",
      "--yui-fs-caption",
      "--yui-fs-sub",
      "--yui-fs-body",
      "--yui-fs-head",
      "--yui-fs-title",
      "--yui-fs-speech",
      "--yui-radius-group",
      "--yui-radius-control",
      "--yui-radius-pill",
      "--yui-panel-bg",
      "--yui-group-bg",
      "--yui-hover",
      "--yui-selected",
      "--yui-field",
      "--yui-track",
      "--yui-knob",
      "--yui-knob-shadow",
    ]) {
      expect(tokensCss).toContain(name);
    }
  });

  it("leaves no raw oklch literal in the quick-controls stylesheets", () => {
    const offenders = cssFilesUnder(join("src", "ui", "quick-controls")).filter((path) =>
      readFileSync(path, "utf8").includes("oklch("),
    );
    expect(offenders).toEqual([]);
  });

  it("bundles Pretendard JP and fixes the color scheme to dark", () => {
    expect(stylesCss).toContain("color-scheme: dark;");
    expect(stylesCss).toContain('url("/fonts/PretendardJPVariable.woff2")');
    expect(existsSync("public/fonts/PretendardJPVariable.woff2")).toBe(true);
  });

  it("leaves no raw system-ui font stack outside the token definition", () => {
    const offenders = cssFilesUnder("src")
      .filter((path) => path !== join("src", "ui", "tokens.css"))
      .filter((path) => readFileSync(path, "utf8").includes("system-ui"));
    expect(offenders).toEqual([]);
  });
});
