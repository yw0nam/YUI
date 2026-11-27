import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { formatMap, MAPS, parseMap } from "./ci/architecture-map.mjs";

const root = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const formatted = [];
for (const scope of MAPS) {
  const parsed = parseMap(readFileSync(resolve(root, scope.file), "utf8"));
  if (parsed.problems.length) {
    for (const problem of parsed.problems) console.error(`${scope.file}: ${problem}`);
    process.exitCode = 1;
    continue;
  }
  const text = formatMap(parsed.map);
  if (!isDeepStrictEqual(JSON.parse(text.slice(text.indexOf("\n") + 1)), parsed.map)) {
    console.error(`${scope.file}: formatted text does not parse back to the map`);
    process.exitCode = 1;
    continue;
  }
  formatted.push([scope.file, text]);
}
if (!process.exitCode) {
  for (const [file, text] of formatted) writeFileSync(resolve(root, file), text);
}
