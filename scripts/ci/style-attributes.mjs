// No root page carries an inline `<style>`, so Tauri adds no style nonce to the CSP and WebKit keeps
// honouring `style-src 'unsafe-inline'`. Inline `style=` attributes stay banned: styles go through
// classes or CSSOM writes (`el.style.setProperty`, `el.style.cssText =`), which CSP does not govern, so a
// future nonce cannot silently drop them.
// Exits 1 and lists each `<style>` in a root page, each `style=` in `src/` markup or a root page and
// each `setAttribute("style"`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `style=` not preceded by a word char, `.`, `$` or `-` (`data-style=`), then a quote or `${`.
const WRITE = /(?<![\w.$-])style=(?:["']|\$\{)|setAttribute\(\s*["'`]style["'`]/g;

const STYLE_ELEMENT = /<style[\s>]/gi;

/** Each inline `<style>` element in `text`: its 1-based line and the matched text. */
export function findInlineStyleElements(text) {
  return [...text.matchAll(STYLE_ELEMENT)].map((m) => ({
    line: text.slice(0, m.index).split("\n").length,
    hit: m[0].trimEnd().replace(/>$/, ""),
  }));
}

/** Each inline-style write in `text`: its 1-based line and the matched text. */
export function findInlineStyleWrites(text) {
  return [...text.matchAll(WRITE)].map((m) => ({
    line: text.slice(0, m.index).split("\n").length,
    hit: m[0],
  }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p);
    }
  };
  walk("src");
  const pages = readdirSync(".").filter((name) => name.endsWith(".html"));
  const list = (paths, find) =>
    paths.flatMap((file) =>
      find(readFileSync(file, "utf8")).map((c) => `${file}:${c.line}: ${c.hit}`),
    );
  const failures = [
    [
      "an inline <style> in a root page makes Tauri add a style nonce, and WebKit then ignores style-src 'unsafe-inline'; move the rules to a stylesheet",
      list(pages, findInlineStyleElements),
    ],
    [
      "an inline style attribute is banned so a future nonce cannot silently drop it; set a CSS variable with el.style.setProperty or use a data- attribute and CSS",
      list([...files, ...pages], findInlineStyleWrites),
    ],
  ].filter(([, bad]) => bad.length);
  for (const [message, bad] of failures)
    console.error(`${message} (${bad.length}):\n${bad.join("\n")}`);
  if (failures.length) process.exit(1);
}
