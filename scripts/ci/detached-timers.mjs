// A timer function is called on its own or on `window`/`globalThis`/`self`, never as a method of
// another object: WebKit throws "Can only call Window.setInterval on instances of Window" for
// `deps.setInterval(...)`, and the fake timers of a unit test do not (#1916). Bind it to a local
// first: `const setIntervalImpl = deps.setInterval;`. Exits 1 and lists each call.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
  }
};
walk("src");

const CALL =
  /([A-Za-z_$][\w$]*|\)|\])\s*(?:\?\.|\.)\s*(setInterval|setTimeout|clearInterval|clearTimeout)\s*(?:\?\.)?\(/g;
const GLOBAL = new Set(["window", "globalThis", "self"]);

const bad = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CALL)) {
      if (!GLOBAL.has(m[1])) bad.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}
if (bad.length) {
  console.error(
    `call a timer detached, not as a method (${bad.length}); bind it to a local first:\n${bad.join("\n")}`,
  );
  process.exit(1);
}
