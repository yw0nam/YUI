import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MAP } from "./ci/architecture-map.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = process.argv[2] ?? DEFAULT_MAP;
const result = spawnSync("git", ["show", `origin/main:${path}`], { cwd: root, encoding: "utf8" });
if (result.status === 0) {
  if (!result.stdout.startsWith("globalThis.YUI_MAP =\n")) {
    console.error(`parsing: ${path} first line must be globalThis.YUI_MAP =`);
    process.exitCode = 1;
  } else {
    writeFileSync(
      resolve(root, dirname(path), "map.base.js"),
      result.stdout.replace("globalThis.YUI_MAP =\n", "globalThis.YUI_MAP_BASE =\n"),
    );
  }
} else {
  const exists = spawnSync("git", ["cat-file", "-e", "origin/main^{commit}"], {
    cwd: root,
    encoding: "utf8",
  });
  if (exists.status === 0 && /does not exist in|exists on disk, but not in/.test(result.stderr)) {
    console.log(`${path} does not exist on origin/main`);
  } else {
    console.error(result.error?.message ?? result.stderr.trim());
    process.exitCode = 1;
  }
}
