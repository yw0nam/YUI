// The app's CSP carries a nonce, which makes the browser ignore `style-src 'unsafe-inline'`, so an
// inline `style` attribute is dropped in the app while the dev server (no CSP) keeps it (#1926).
// Set a CSS variable with `el.style.setProperty("--x", v)` or use a `data-` attribute and CSS.
// CSSOM writes (`el.style.setProperty`, `el.style.cssText =`) are not governed by CSP and pass.
// Exits 1 and lists each `style=` in markup and each `setAttribute("style"`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// `style=` not preceded by a word char, `.`, `$` or `-` (`data-style=`), then a quote or `${`.
const WRITE = /(?<![\w.$-])style=(?:["']|\$\{)|setAttribute\(\s*["'`]style["'`]/g;

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
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
    }
  };
  walk("src");
  const bad = files.flatMap((file) =>
    findInlineStyleWrites(readFileSync(file, "utf8")).map((c) => `${file}:${c.line}: ${c.hit}`),
  );
  if (bad.length) {
    console.error(
      `the app's CSP drops an inline style attribute (${bad.length}); set a CSS variable with el.style.setProperty or use a data- attribute and CSS:\n${bad.join("\n")}`,
    );
    process.exit(1);
  }
}
