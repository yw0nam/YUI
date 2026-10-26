// The token contract covers bundled type, surface roles, and both themes.

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
      "--yui-accent-ink",
      "--yui-avatar-l",
      "--yui-avatar-c",
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

  it("leaves no literal colour outside the theme tokens", () => {
    const offenders = cssFilesUnder(join("src", "ui"))
      .filter((path) => path !== join("src", "ui", "tokens.css"))
      .flatMap((path) =>
        readFileSync(path, "utf8")
          .split("\n")
          .filter(
            (line) =>
              line.includes("%23") ||
              (line.includes("oklch(") && !/^\s*(?:-webkit-)?mask-image:/.test(line)),
          )
          .map((line) => `${path}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it("bundles Pretendard JP and declares each theme color scheme", () => {
    const [dawn, hearth] = tokensCss.split(':root[data-theme="hearth"]');
    expect(dawn).toContain("color-scheme: light;");
    expect(hearth).toContain("color-scheme: dark;");
    expect(stylesCss).toContain('url("/fonts/PretendardJPVariable.woff2")');
    expect(existsSync("public/fonts/PretendardJPVariable.woff2")).toBe(true);
  });

  it("mirrors the DESIGN frontmatter colours in each theme", () => {
    const frontmatter = readFileSync("DESIGN.md", "utf8").split("---")[1];
    const [dawn, hearth] = tokensCss.split(':root[data-theme="hearth"]');
    for (const [section, block] of [
      ["colors", dawn],
      ["colors_hearth", hearth],
    ]) {
      const values = frontmatter.split(`${section}:\n`)[1].split(/\n[^ ]/)[0];
      for (const match of values.matchAll(/^ {2}([a-z-]+): "([^"]+)"/gm)) {
        expect(block).toContain(`--yui-${match[1]}: ${match[2]};`);
      }
    }
  });

  it("declares every Dawn colour token in Hearth", () => {
    const [dawn, hearth = ""] = tokensCss.split(':root[data-theme="hearth"]');
    const hearthNames = [...hearth.matchAll(/(--yui-[a-z-]+):/g)].map((match) => match[1]);
    for (const match of dawn.matchAll(/(--yui-[a-z-]+): ([^;]+);/g)) {
      if (match[2].includes("oklch(") || match[2] === "none") {
        expect(hearthNames).toContain(match[1]);
      }
    }
  });

  it("leaves no raw system-ui font stack outside the token definition", () => {
    const offenders = cssFilesUnder("src")
      .filter((path) => path !== join("src", "ui", "tokens.css"))
      .filter((path) => readFileSync(path, "utf8").includes("system-ui"));
    expect(offenders).toEqual([]);
  });
});
