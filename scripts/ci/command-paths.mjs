// A Tauri command takes no file path from the webview: the dialog opens in Rust and the command
// resolves the path itself (`src-tauri/src/card_import.rs`). Fails on a `#[command]` fn whose
// parameters carry `FilePath`, `PathBuf`, `&Path`, or a name containing `path`.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".rs")) files.push(p);
  }
};
walk("src-tauri/src");

const command =
  /#\[(?:tauri::)?command\]\s*pub\s+(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)/g;
const pathParam = /FilePath|PathBuf|&\s*Path\b|\w*path\w*\s*:/;
const bad = [];
for (const file of files) {
  for (const m of readFileSync(file, "utf8").matchAll(command)) {
    if (pathParam.test(m[2])) bad.push(`${file}: ${m[1]}(${m[2].trim()})`);
  }
}
if (bad.length) {
  console.error(`a command takes a path from the webview (${bad.length}):\n${bad.join("\n")}`);
  process.exit(1);
}
