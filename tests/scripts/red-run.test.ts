import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const HAS_UV = spawnSync("uv", ["--version"]).status === 0;

function write(repo: string, files: Record<string, string>): void {
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, name)), { recursive: true });
    writeFileSync(join(repo, name), body);
  }
}

/** A repo whose HEAD is a test commit adding `files` over a base that holds `one() === 1` and `base`. */
function testCommit(
  files: Record<string, string>,
  base: Record<string, string> = {},
): { repo: string; commit: string } {
  const repo = mkdtempSync(join(tmpdir(), "yui-red-run-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  mkdirSync(join(repo, "scripts"));
  copyFileSync(join(ROOT, "scripts/red-run.sh"), join(repo, "scripts/red-run.sh"));
  // The real setup script installs from the lockfile; the fixture borrows this checkout's modules.
  writeFileSync(
    join(repo, "scripts/worktree-setup.sh"),
    `ln -s "${ROOT}/node_modules" "$1/node_modules"\n`,
  );
  write(repo, { "one.ts": "export const one = () => 1;\n", ...base });
  git(repo, "init", "-q");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  write(repo, files);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "test: cases");
  return { repo, commit: git(repo, "rev-parse", "HEAD") };
}

function redRun(repo: string, commit: string, env: NodeJS.ProcessEnv = process.env) {
  const r = spawnSync(BASH, ["scripts/red-run.sh", commit], { cwd: repo, encoding: "utf8", env });
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

  it("reads .resolves, .rejects and expect.assertions failures as assertions and a timeout as harness", () => {
    const { repo, commit } = testCommit({
      "async.test.ts": `import { expect, it } from "vitest";
it("resolves two", async () => {
  await expect(Promise.resolve(1)).resolves.toBe(2);
});
it("rejects with x", async () => {
  await expect(Promise.reject(new Error("y"))).rejects.toThrow("x");
});
it("counts assertions", () => {
  expect.assertions(1);
});
it("times out", async () => {
  await new Promise(() => {});
}, 50);
`,
    });
    const { status, out } = redRun(repo, commit);
    expect(out).toMatch(/^ {2}red {6}resolves two /m);
    expect(out).toMatch(/^ {2}red {6}rejects with x /m);
    expect(out).toMatch(/^ {2}red {6}counts assertions /m);
    expect(out).toMatch(/^ {2}harness {2}times out .*timed out/m);
    expect(status).toBe(1);
  });

  it("does not match an added title against an older case that merely starts the same", () => {
    const { repo, commit } = testCommit(
      {
        "old.test.ts": `import { expect, it } from "vitest";
import { one } from "./one";
it("is one", () => expect(one()).toBe(1));
it("sends the old", () => expect(one()).toBe(1));
it("is", () => expect(one()).toBe(2));
it.each(["new"])("sends $0", (v) => expect(v).toBe("x"));
it("it's two", () => expect(one()).toBe(2));
`,
        "new.test.ts": `import { expect, it } from "vitest";
it.each(["a"])("gives %s", (v) => expect(v).toBe("x"));
`,
      },
      {
        "old.test.ts": `import { expect, it } from "vitest";
import { one } from "./one";
it("is one", () => expect(one()).toBe(1));
it("sends the old", () => expect(one()).toBe(1));
`,
      },
    );
    const { status, out } = redRun(repo, commit);
    expect(out).toContain("4 red, 0 harness, 0 passes, 0 unmatched");
    expect(status).toBe(0);
  });

  it.skipIf(!HAS_UV)("reads pytest.fail as an assertion and keeps a longer name apart", () => {
    const { repo, commit } = testCommit(
      {
        "plugins/p/tests/test_a.py": `import pytest


def test_param_old_ok():
    assert True


def test_param():
    assert 1 == 2


def test_fails():
    pytest.fail("nope")
`,
      },
      {
        "plugins/p/pyproject.toml": `[project]
name = "p"
version = "0"
requires-python = ">=3.9"

[dependency-groups]
dev = ["pytest"]
`,
        "plugins/p/tests/test_a.py": `def test_param_old_ok():
    assert True
`,
      },
    );
    const { status, out } = redRun(repo, commit);
    expect(out).toContain("2 red, 0 harness, 0 passes, 0 unmatched");
    expect(status).toBe(0);
  });

  it("exits 2 for a commit that only changes Rust tests", () => {
    const { repo, commit } = testCommit({ "src/thing_test.rs": "#[test]\nfn t() {}\n" });
    const { status, out } = redRun(repo, commit);
    expect(out).toMatch(/Rust/);
    expect(status).toBe(2);
  });

  it("leaves no temp directory behind when the commit cannot be checked out", () => {
    const { repo } = testCommit({ "red.test.ts": "" });
    const tmp = mkdtempSync(join(tmpdir(), "yui-red-run-tmp-"));
    cleanups.push(() => rmSync(tmp, { recursive: true, force: true }));
    const { status } = redRun(repo, "no-such-commit", { ...process.env, TMPDIR: tmp });
    expect(status).toBe(2);
    expect(readdirSync(tmp)).toEqual([]);
  });
});
