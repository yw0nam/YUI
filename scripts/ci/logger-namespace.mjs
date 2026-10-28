// Every `createLogger("<ns>")` names the file it sits in: `<ns>` equals the file's
// basename without `.ts`, and every log event name is snake_case, dots between segments
// (`docs/reference/logging.md`). Exits 1 and lists each mismatch.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) files.push(p);
  }
};
walk("src");

// Namespaces that predate the rule and are cited by log-line docs and skills; the list only shrinks.
const KNOWN = new Set([
  "src/app/bootstrap-configured.ts:bootstrap",
  "src/app/message/wire-message-surface-ops.ts:message-bootstrap",
  "src/app/settings-window/wire-settings-window.ts:settings-bootstrap",
  "src/app/stage/wire-window-geometry.ts:window-geometry",
  "src/app/turn/turn-core.ts:bootstrap",
  "src/dispatcher/sources/gesture/window-drop/perch-watch.ts:window-drop",
  "src/dispatcher/sources/gesture/window-drop/placement.ts:window-drop",
  "src/dispatcher/sources/gesture/window-drop/window-drop-source.ts:window-drop",
  "src/io/bridge/core/bridge-core.ts:settings-bridge",
  "src/io/window/capture/tauri-screen.ts:screen",
  "src/io/window/pet/gesture/click-gesture.ts:drag",
  "src/io/window/pet/gesture/window-drag.ts:drag",
  "src/io/window/pet/window-resize-source.ts:window-resize",
  "src/renderer/index.ts:renderer",
  "src/windows/devtools-main.ts:devtools-bootstrap",
  "src/windows/main.ts:bootstrap",
  "src/windows/message-main.ts:message-bootstrap",
  "src/windows/settings-main.ts:settings-bootstrap",
]);

const EVENT = /^[a-z0-9_]+(\.[a-z0-9_]+)*$/;

const bad = [];
const badEvents = [];
for (const file of files) {
  const stem = basename(file, ".ts");
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/createLogger\(\s*"([^"]*)"/g)) {
    if (m[1] !== stem && !KNOWN.has(`${file}:${m[1]}`))
      bad.push(`${file}: createLogger("${m[1]}") in ${stem}.ts`);
  }
  // A space in an event name made `push rejected` ungreppable beside `push_rejected` (#1546).
  for (const m of text.matchAll(/\blog\.(?:debug|info|warn|error)\(\s*"([^"]*)"/g)) {
    if (!EVENT.test(m[1])) badEvents.push(`${file}: log event "${m[1]}"`);
  }
}
if (bad.length) {
  console.error(`logger namespace must equal the file name (${bad.length}):\n${bad.join("\n")}`);
}
if (badEvents.length) {
  console.error(`log event names are snake_case (${badEvents.length}):\n${badEvents.join("\n")}`);
}
if (bad.length || badEvents.length) process.exit(1);
