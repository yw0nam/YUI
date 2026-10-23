import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A bare class selector (`.yui-x {`) declared in two stylesheets styles one element from two
// places, and the later sheet wins on equal specificity with no error anywhere; a new block that
// reuses an existing name inherits rules written for another surface.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
// Declared in two sheets today; delete an entry when the block gets one owner.
const KNOWN = new Set([
  ".yui-chat-status",
  ".yui-hist__foot",
  ".yui-mon__badge",
  ".yui-session__deleg-lost",
  ".yui-spk__badge",
  ".yui-spk__body",
  ".yui-spk__name",
  ".yui-vrm__badge",
]);

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith(".css")) out.push(path);
  }
  return out;
}

function bareSelectors(css) {
  const out = [];
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of stripped.matchAll(/(?:^|[}\n])\s*([^{}@]+?)\s*\{/g)) {
    for (const part of m[1].split(",")) {
      const sel = part.trim();
      if (/^\.yui-[a-z0-9_-]+$/.test(sel)) out.push(sel);
    }
  }
  return out;
}

const files = new Map();
for (const path of cssFiles(join(ROOT, "src"))) {
  for (const sel of new Set(bareSelectors(readFileSync(path, "utf8")))) {
    if (!files.has(sel)) files.set(sel, []);
    files.get(sel).push(relative(ROOT, path));
  }
}

const errors = [];
for (const [sel, paths] of files) {
  if (paths.length > 1 && !KNOWN.has(sel)) {
    errors.push(`${sel} is declared in ${paths.length} stylesheets: ${paths.sort().join(", ")}`);
  }
}
for (const sel of KNOWN) {
  if ((files.get(sel)?.length ?? 0) < 2) {
    errors.push(`${sel} has one owner now: remove it from KNOWN in scripts/ci/css-selectors.mjs`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`css-selectors: ${e}`);
  process.exit(1);
}
console.log(`css-selectors: ${files.size} bare class selectors, each with one owner outside KNOWN`);
