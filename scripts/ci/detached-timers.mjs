// A timer function is called on its own or on `window`/`globalThis`, never as a method of
// another object: WebKit throws "Can only call Window.setInterval on instances of Window" for
// `deps.setInterval(...)`, and the fake timers of a unit test do not (#1916). Bind it to a local
// first: `const setIntervalImpl = deps.setInterval;`. Exits 1 and lists each call.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Across lines too: `deps\n  .setInterval(`, `deps!.setTimeout!(`, `deps.setTimeout?.(`.
const CALL =
  /([A-Za-z_$][\w$]*|\)|\])!?\s*\??\.\s*(setInterval|setTimeout|clearInterval|clearTimeout)\s*!?\s*(?:\?\.)?\(/g;
const GLOBAL = new Set(["window", "globalThis"]);

/** Each timer called as a method in `text`: its 1-based line and the call, whitespace collapsed. */
export function findMethodTimerCalls(text) {
  const found = [];
  for (const m of text.matchAll(CALL)) {
    if (GLOBAL.has(m[1])) continue;
    found.push({
      line: text.slice(0, m.index).split("\n").length,
      call: m[0].replace(/\s+/g, " "),
    });
  }
  return found;
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
    findMethodTimerCalls(readFileSync(file, "utf8")).map((c) => `${file}:${c.line}: ${c.call}`),
  );
  if (bad.length) {
    console.error(
      `call a timer detached, not as a method (${bad.length}); bind it to a local first:\n${bad.join("\n")}`,
    );
    process.exit(1);
  }
}
