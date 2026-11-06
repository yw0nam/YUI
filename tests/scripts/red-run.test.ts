import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASH } from "../command-paths";

vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
}

/** A repo whose HEAD is a test commit adding `files` over a base that holds `one() === 1`. */
function testCommit(files: Record<string, string>): { repo: string; commit: string } {
  const repo = mkdtempSync(join(tmpdir(), "yui-red-run-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "scripts"));
  copyFileSync(join(ROOT, "scripts/red-run.sh"), join(repo, "scripts/red-run.sh"));
  // The real setup script installs from the lockfile; the fixture borrows this checkout's modules.
  writeFileSync(
    join(repo, "scripts/worktree-setup.sh"),
    `ln -s "${ROOT}/node_modules" "$1/node_modules"\n`,
  );
  writeFileSync(join(repo, "one.ts"), "export const one = () => 1;\n");
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  for (const [name, body] of Object.entries(files)) writeFileSync(join(repo, name), body);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "test: cases");
  return { repo, commit: git(repo, "rev-parse", "HEAD") };
}

function redRun(repo: string, commit: string) {
  const r = spawnSync(BASH, ["scripts/red-run.sh", commit], { cwd: repo, encoding: "utf8" });
  return { status: r.status, out: r.stdout };
}

describe("scripts/red-run.sh", () => {
  it("tells a failed assertion from a failure before any assertion and exits 1 on the harness case", () => {
    const { repo, commit } = testCommit({
      "red.test.ts": `import { expect, it } from "vitest";
import { one } from "./one";
it("is two", () => expect(one()).toBe(2));
it("is one", () => expect(one()).toBe(1));
`,
      "missing.test.ts": `import { expect, it } from "vitest";
import { nope } from "./nope";
it("uses nope", () => expect(nope()).toBe(1));
`,
    });
    const { status, out } = redRun(repo, commit);
    expect(out).toMatch(/^ {2}red {6}is two {2}\[red\.test\.ts\] {2}AssertionError/m);
    expect(out).toMatch(/^ {2}passes {3}is one /m);
    expect(out).toMatch(
      /^ {2}harness {2}uses nope {2}\[missing\.test\.ts\] {2}.*Cannot find module/m,
    );
    expect(status).toBe(1);
  });

  it("exits 0 when every added case fails on an assertion", () => {
    const { repo, commit } = testCommit({
      "red.test.ts": `import { expect, it } from "vitest";
import { one } from "./one";
it("is two", () => expect(one()).toBe(2));
`,
    });
    const { status, out } = redRun(repo, commit);
    expect(out).toContain("1 red, 0 harness, 0 passes");
    expect(status).toBe(0);
  });
});
