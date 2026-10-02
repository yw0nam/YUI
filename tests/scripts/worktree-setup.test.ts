import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const SETUP = join(ROOT, "scripts/worktree-setup.sh");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Main-checkout fixture carrying the gitignored runtime assets. */
function makeMainCheckout(opts: { envLocal?: boolean } = {}): string {
  const main = tmp("yui-main-");
  mkdirSync(join(main, "resources/vrms"), { recursive: true });
  writeFileSync(join(main, "resources/vrms/carlotta.vrm"), "vrm-bytes");
  if (opts.envLocal !== false) {
    writeFileSync(join(main, ".env.local"), "VITE_YUI_CHAT_KEY=secret");
  }
  return main;
}

describe("scripts/worktree-setup.sh", () => {
  it("links the VRM and copies .env.local", () => {
    const main = makeMainCheckout();
    const wt = tmp("yui-wt-");
    const r = spawnSync("bash", [SETUP, wt, main], { encoding: "utf8" });
    expect(r.status).toBe(0);

    const vrm = join(wt, "resources/vrms/carlotta.vrm");
    expect(lstatSync(vrm).isSymbolicLink()).toBe(true);
    expect(readFileSync(vrm, "utf8")).toBe("vrm-bytes");

    expect(readFileSync(join(wt, ".env.local"), "utf8")).toContain("VITE_YUI_CHAT_KEY");
  });

  it("links the main checkout's local .claude/ when it exists and skips it otherwise", () => {
    const main = makeMainCheckout();
    const bare = tmp("yui-wt-");
    expect(spawnSync("bash", [SETUP, bare, main]).status).toBe(0);
    expect(existsSync(join(bare, ".claude"))).toBe(false);

    mkdirSync(join(main, ".claude"));
    writeFileSync(join(main, ".claude/settings.json"), "{}");
    const wt = tmp("yui-wt-");
    expect(spawnSync("bash", [SETUP, wt, main]).status).toBe(0);
    expect(lstatSync(join(wt, ".claude")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(wt, ".claude/settings.json"), "utf8")).toBe("{}");
  });

  it("is idempotent — a second run succeeds and keeps the links", () => {
    const main = makeMainCheckout();
    const wt = tmp("yui-wt-");
    expect(spawnSync("bash", [SETUP, wt, main]).status).toBe(0);
    expect(spawnSync("bash", [SETUP, wt, main]).status).toBe(0);
    expect(lstatSync(join(wt, "resources/vrms/carlotta.vrm")).isSymbolicLink()).toBe(true);
  });

  it("succeeds when .env.local is absent in the main checkout", () => {
    const main = makeMainCheckout({ envLocal: false });
    const wt = tmp("yui-wt-");
    const r = spawnSync("bash", [SETUP, wt, main], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(existsSync(join(wt, ".env.local"))).toBe(false);
  });

  it("resolves relative arguments so symlinks survive any caller cwd", () => {
    const main = makeMainCheckout();
    const wt = tmp("yui-wt-");
    const r = spawnSync("bash", [SETUP, basename(wt), basename(main)], {
      encoding: "utf8",
      cwd: dirname(wt),
    });
    expect(r.status).toBe(0);
    expect(readFileSync(join(wt, "resources/vrms/carlotta.vrm"), "utf8")).toBe("vrm-bytes");
  });

  it("exits non-zero with usage when called without arguments", () => {
    const r = spawnSync("bash", [SETUP], { encoding: "utf8" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/usage/i);
  });
});
