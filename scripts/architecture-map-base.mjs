import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAP } from "./ci/architecture-map.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shown = spawnSync("git", ["show", `origin/main:${MAP}`], { cwd: root, encoding: "utf8" });
if (shown.status !== 0 || !shown.stdout.startsWith("globalThis.YUI_MAP =\n")) {
  console.error(
    shown.stderr.trim() || `${MAP} on origin/main does not start with globalThis.YUI_MAP =`,
  );
  process.exitCode = 1;
} else {
  writeFileSync(
    resolve(root, dirname(MAP), "map.base.js"),
    shown.stdout.replace("globalThis.YUI_MAP =\n", "globalThis.YUI_MAP_BASE =\n"),
  );
}
