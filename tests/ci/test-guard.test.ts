import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const GUARD = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../scripts/ci/test-guard.sh",
);

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function git(repo: string, ...args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

/** Repo with a main branch and a feature branch carrying the given files. */
function makeBranchedRepo(files: Record<string, string>): string {
  const repo = mkdtempSync(join(tmpdir(), "yui-guard-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "README.md"), "base");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "feat/change");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "change");
  return repo;
}

function runGuard(repo: string, env: Record<string, string> = {}) {
  const r = spawnSync("bash", [GUARD, "main"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, TEST_GUARD_SKIP: "", TEST_GUARD_THRESHOLD: "", ...env },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const bigSource = Array.from({ length: 30 }, (_, i) => `export const v${i} = ${i};`).join("\n");

describe("scripts/ci/test-guard.sh", () => {
  it("fails when source changes exceed the threshold without test changes", () => {
    const repo = makeBranchedRepo({ "src/feature.ts": bigSource });
    const r = runGuard(repo);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/skip-tests/);
  });

  it("passes when a test file accompanies the source change", () => {
    const repo = makeBranchedRepo({
      "src/feature.ts": bigSource,
      "src/feature.test.ts": "it('works', () => {});",
    });
    expect(runGuard(repo).status).toBe(0);
  });

  it("passes when a tests/ file accompanies the source change", () => {
    const repo = makeBranchedRepo({
      "src/feature.ts": bigSource,
      "tests/feature.test.ts": "it('works', () => {});",
    });
    expect(runGuard(repo).status).toBe(0);
  });

  it("passes small changes at or below the threshold", () => {
    const repo = makeBranchedRepo({ "src/tiny.ts": "export const a = 1;" });
    expect(runGuard(repo).status).toBe(0);
  });

  it("ignores changes outside src/ and src-tauri/", () => {
    const repo = makeBranchedRepo({ "docs/feature.md": bigSource });
    expect(runGuard(repo).status).toBe(0);
  });

  it("fails on large Rust changes without tests", () => {
    const repo = makeBranchedRepo({
      "src-tauri/src/feature.rs": Array.from(
        { length: 30 },
        (_, i) => `pub const V${i}: u8 = ${i};`,
      ).join("\n"),
    });
    expect(runGuard(repo).status).toBe(1);
  });

  it("accepts inline #[test] additions as Rust test changes", () => {
    const repo = makeBranchedRepo({
      "src-tauri/src/feature.rs": `${Array.from({ length: 30 }, (_, i) => `pub const V${i}: u8 = ${i};`).join("\n")}
#[cfg(test)]
mod tests {
    #[test]
    fn covers_feature() {}
}
`,
    });
    expect(runGuard(repo).status).toBe(0);
  });

  it("skips entirely when TEST_GUARD_SKIP=1 (skip-tests label)", () => {
    const repo = makeBranchedRepo({ "src/feature.ts": bigSource });
    expect(runGuard(repo, { TEST_GUARD_SKIP: "1" }).status).toBe(0);
  });

  it("honors TEST_GUARD_THRESHOLD", () => {
    const repo = makeBranchedRepo({ "src/tiny.ts": "export const a = 1;\nexport const b = 2;" });
    expect(runGuard(repo, { TEST_GUARD_THRESHOLD: "1" }).status).toBe(1);
  });
});
