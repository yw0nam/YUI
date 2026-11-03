import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

/** The command names `generate_handler!` registers: the last segment of each `crate::…` path. */
const handler = [...read("src-tauri/src/commands.rs").matchAll(/crate::[\w:]+::(\w+)/g)].map(
  (m) => m[1]!,
);

/** The app manifest's `COMMANDS` list in build.rs. */
const manifest = [
  .../const COMMANDS: &\[&str\] = &\[([^\]]*)\]/
    .exec(read("src-tauri/build.rs"))![1]!
    .matchAll(/"(\w+)"/g),
].map((m) => m[1]!);

/** Every string permission in every capability file. */
const permissions = new Set(
  readdirSync(join(ROOT, "src-tauri/capabilities")).flatMap((file) =>
    (
      JSON.parse(read(`src-tauri/capabilities/${file}`)) as { permissions: unknown[] }
    ).permissions.filter((p): p is string => typeof p === "string"),
  ),
);

describe("app command permissions", () => {
  it("reads both lists", () => {
    expect(handler.length).toBeGreaterThan(0);
    expect(manifest.length).toBeGreaterThan(0);
  });

  it("lists every registered command in the app manifest, or the call is refused at runtime", () => {
    expect(handler.filter((name) => !manifest.includes(name))).toEqual([]);
  });

  it("grants every manifest command to some window through allow-<command>", () => {
    expect(
      manifest.filter((name) => !permissions.has(`allow-${name.replaceAll("_", "-")}`)),
    ).toEqual([]);
  });
});
