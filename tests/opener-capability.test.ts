import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

interface OpenUrlEntry {
  identifier: string;
  allow: Array<{ url: string }>;
}

const CAPABILITY_FILES = [
  "src-tauri/capabilities/default.json",
  "src-tauri/capabilities/message.json",
] as const;

/** Object-form `opener:allow-open-url` entries in one capability file's permissions. */
function openerEntries(file: string): OpenUrlEntry[] {
  const parsed = JSON.parse(readFileSync(join(ROOT, file), "utf8")) as {
    permissions: unknown[];
  };
  return parsed.permissions.filter(
    (p): p is OpenUrlEntry =>
      typeof p === "object" && p !== null && (p as OpenUrlEntry).identifier === "opener:allow-open-url",
  );
}

describe("opener capability wiring", () => {
  it.each(CAPABILITY_FILES)(
    "%s grants exactly one opener:allow-open-url scoped to http/https",
    (file) => {
      const entries = openerEntries(file);
      expect(entries).toHaveLength(1);
      expect(entries[0].allow).toEqual([{ url: "http://*" }, { url: "https://*" }]);
    },
  );

  it("declares the tauri-plugin-opener dependency in Cargo.toml", () => {
    const cargo = readFileSync(join(ROOT, "src-tauri/Cargo.toml"), "utf8");
    const line = cargo.split("\n").find((l) => l.startsWith("tauri-plugin-opener ="));
    expect(line).toBeDefined();
  });

  it("initializes the opener plugin in lib.rs", () => {
    const lib = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(lib).toContain("tauri_plugin_opener::init()");
  });
});
