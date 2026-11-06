import { describe, expect, it } from "vitest";
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
