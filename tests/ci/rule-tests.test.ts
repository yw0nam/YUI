import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASH } from "../command-paths";

vi.setConfig({ testTimeout: 15_000 });

const SCRIPT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../scripts/ci/rule-tests.sh",
);

// Built from parts so this file never carries the marker itself.
const MARKER = `rule-${"test"}:`;

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function git(repo: string, ...args: string[]): void {
  execFileSync("git", ["-C", repo, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
}

function write(repo: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  git(repo, "add", ".");
}

/** Repo whose main carries `path` with the marker and whose feature branch edits it. */
function makeRepoEditing(path: string): string {
  const repo = mkdtempSync(join(tmpdir(), "yui-rule-tests-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, "init", "-q", "-b", "main");
  write(repo, { [path]: `// ${MARKER} base\n` });
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "checkout", "-q", "-b", "feat/change");
  write(repo, { [path]: `// ${MARKER} base\nchanged\n` });
  git(repo, "commit", "-q", "-m", "change");
  return repo;
}

function run(repo: string) {
  const r = spawnSync(BASH, [SCRIPT, "main"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, RULE_TESTS_SKIP: "" },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe("scripts/ci/rule-tests.sh", () => {
  it("passes when a doc that mentions the marker changes", () => {
    expect(run(makeRepoEditing("docs/agent-guide/testing.md")).status).toBe(0);
  });

  it("fails when a test file carrying the marker changes", () => {
    const r = run(makeRepoEditing("src/ui/wording.test.ts"));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/rule-change/);
  });

  it("fails when a rule test is moved and loosened", () => {
    const repo = makeRepoEditing("src/ui/wording.test.ts");
    git(repo, "mv", "src/ui/wording.test.ts", "src/ui/wording-moved.test.ts");
    // Similar enough that git reports a rename, which hides the old path.
    write(repo, { "src/ui/wording-moved.test.ts": `// ${MARKER} base\nchanged\nloosened\n` });
    git(repo, "commit", "-q", "-m", "move");
    expect(run(repo).status).toBe(1);
  });
});
