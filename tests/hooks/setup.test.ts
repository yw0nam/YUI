import { execFileSync, spawnSync } from "node:child_process";
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
const HOOKS = join(ROOT, ".claude/hooks");

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
}

/** Main-checkout fixture carrying the gitignored runtime assets. */
function makeMainCheckout(opts: { envLocal?: boolean } = {}): string {
  const main = tmp("yui-main-");
  mkdirSync(join(main, "resources/vrms"), { recursive: true });
  mkdirSync(join(main, "resources/references/natsume"), { recursive: true });
  writeFileSync(join(main, "resources/vrms/carlotta.vrm"), "vrm-bytes");
  writeFileSync(join(main, "resources/references/natsume/merged_audio.mp3"), "clip-bytes");
  if (opts.envLocal !== false) {
    writeFileSync(join(main, ".env.local"), "VITE_YUI_CHAT_KEY=secret");
  }
  return main;
}

describe("scripts/worktree-setup.sh", () => {
  it("links the VRM, links each reference speaker, and copies .env.local", () => {
    const main = makeMainCheckout();
    const wt = tmp("yui-wt-");
    // .gitkeep keeps resources/references tracked, so a real worktree already carries the directory
    // — linking the whole directory would nest inside it instead of populating it.
    mkdirSync(join(wt, "resources/references"), { recursive: true });
    const r = spawnSync("bash", [SETUP, wt, main], { encoding: "utf8" });
    expect(r.status).toBe(0);

    const vrm = join(wt, "resources/vrms/carlotta.vrm");
    expect(lstatSync(vrm).isSymbolicLink()).toBe(true);
    expect(readFileSync(vrm, "utf8")).toBe("vrm-bytes");

    const speaker = join(wt, "resources/references/natsume");
    expect(lstatSync(speaker).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(speaker, "merged_audio.mp3"), "utf8")).toBe("clip-bytes");
    expect(existsSync(join(wt, "resources/references/references"))).toBe(false);

    expect(readFileSync(join(wt, ".env.local"), "utf8")).toContain("VITE_YUI_CHAT_KEY");
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

describe(".claude/hooks/worktree-create.sh", () => {
  it("creates a worktree for the requested branch and prints its path", () => {
    const repo = tmp("yui-repo-");
    execFileSync("git", ["-C", repo, "init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "README.md"), "x");
    execFileSync("git", ["-C", repo, "add", "."], { env: gitEnv() });
    execFileSync("git", ["-C", repo, "commit", "-q", "-m", "init"], { env: gitEnv() });

    const r = spawnSync("bash", [join(HOOKS, "worktree-create.sh")], {
      input: JSON.stringify({ cwd: repo, branch: "feat/hook-made" }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
    });
    expect(r.status).toBe(0);

    const path = r.stdout.trim().split("\n").pop() ?? "";
    cleanups.push(() => rmSync(path, { recursive: true, force: true }));
    expect(existsSync(path)).toBe(true);
    const branch = execFileSync("git", ["-C", path, "branch", "--show-current"], {
      encoding: "utf8",
    }).trim();
    expect(branch).toBe("feat/hook-made");
  });

  it("fails (non-zero) when the project is not a git repository", () => {
    const dir = tmp("yui-norepo-");
    const r = spawnSync("bash", [join(HOOKS, "worktree-create.sh")], {
      input: JSON.stringify({ cwd: dir }),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    });
    expect(r.status).not.toBe(0);
  });
});

describe(".claude/settings.json wiring", () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude/settings.json"), "utf8"));

  it("registers the hook portfolio events", () => {
    expect(Object.keys(settings.hooks)).toEqual(
      expect.arrayContaining(["WorktreeCreate", "PreToolUse", "PostToolUse"]),
    );
  });

  it("carries no Stop hook (verify-guard is retired in favor of the PR evidence gate)", () => {
    expect(settings.hooks.Stop).toBeUndefined();
  });

  it("routes every registered hook to an existing script", () => {
    const entries = Object.values(settings.hooks).flat() as Array<{
      hooks: Array<{ command: string }>;
    }>;
    for (const entry of entries) {
      for (const h of entry.hooks) {
        const m = h.command.match(/\.claude\/hooks\/([a-z-]+\.sh)/);
        expect(m, `unparseable hook command: ${h.command}`).toBeTruthy();
        expect(existsSync(join(HOOKS, m![1]))).toBe(true);
      }
    }
  });
});
