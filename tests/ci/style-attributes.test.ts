import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findInlineStyleWrites } from "../../scripts/ci/style-attributes.mjs";

describe("style-attributes check", () => {
  it.each([
    ['const html = `<input style="--n: 5">`;', 'style="'],
    ["const html = \"<i style='--n: 5'>\";", "style='"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the input is markup text, not a template
    ["const html = `<i style=${value}>`;", "style=${"],
    ['el.setAttribute("style", "--n: 5");', 'setAttribute("style"'],
    ["el.setAttribute('style', css);", "setAttribute('style'"],
    ['el.setAttribute( "style", css);', 'setAttribute( "style"'],
  ])("flags %s", (text, hit) => {
    expect(findInlineStyleWrites(text)).toEqual([{ line: 1, hit }]);
  });

  it("reports the 1-based line of the hit", () => {
    expect(findInlineStyleWrites('const a = 1;\nconst b = `<p style="x">`;')).toEqual([
      { line: 2, hit: 'style="' },
    ]);
  });

  it.each([
    'el.style.setProperty("--yui-num-digits", "5");',
    'el.style.width = "10px";',
    'el.setAttribute("data-digits", "5");',
    'const html = `<input data-style="x" class="a">`;',
    'el.style.cssText = "--n: 5";',
    "const style = { color: 'red' };",
  ])("passes %s", (text) => {
    expect(findInlineStyleWrites(text)).toEqual([]);
  });
});

describe("style-attributes check on root pages", () => {
  const script = resolve("scripts/ci/style-attributes.mjs");
  let root = "";
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  // The check reads `src/` and `*.html` from its working directory.
  const run = (pages: Record<string, string>) => {
    root = mkdtempSync(join(tmpdir(), "style-attrs-"));
    mkdirSync(join(root, "src"));
    for (const [name, html] of Object.entries(pages)) writeFileSync(join(root, name), html);
    return spawnSync("node", [script], { cwd: root, encoding: "utf8" });
  };

  it("fails and lists a root page with an inline style element", () => {
    const res = run({ "page.html": "<head>\n<style>\nbody {}\n</style>\n</head>" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("page.html:2: <style");
  });
});
