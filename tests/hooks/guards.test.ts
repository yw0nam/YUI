import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOOKS = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../.claude/hooks");

type HookResult = { status: number | null; stdout: string; stderr: string };

function runHook(script: string, input: unknown, env: Record<string, string> = {}): HookResult {
  const r = spawnSync("bash", [join(HOOKS, script)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, YUI_ALLOW_MAIN: "", ...env },
  });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function denyReason(r: HookResult): string | undefined {
  if (!r.stdout.trim()) return undefined;
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  if (out?.permissionDecision !== "deny") return undefined;
  return out.permissionDecisionReason as string;
}

function makeRepo(branch: string): string {
  const dir = mkdtempSync(join(tmpdir(), "yui-hook-"));
  execFileSync("git", ["-C", dir, "init", "-q", "-b", branch]);
  execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "init"], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    },
  });
  return dir;
}

let mainRepo: string;
let featRepo: string;

beforeAll(() => {
  mainRepo = makeRepo("main");
  featRepo = makeRepo("feat/x");
});

afterAll(() => {
  rmSync(mainRepo, { recursive: true, force: true });
  rmSync(featRepo, { recursive: true, force: true });
});

function bashInput(command: string, cwd: string) {
  return { cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } };
}

describe("pretool-bash-guard.sh — main branch guard", () => {
  it("denies git commit while on main", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput('git commit -m "x"', mainRepo));
    expect(r.status).toBe(0);
    expect(denyReason(r)).toMatch(/main/);
  });

  it("denies git push while on main", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput("git push origin main", mainRepo));
    expect(denyReason(r)).toMatch(/main/);
  });

  it("mentions the YUI_ALLOW_MAIN bypass in the deny reason", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput('git commit -m "x"', mainRepo));
    expect(denyReason(r)).toMatch(/YUI_ALLOW_MAIN=1/);
  });

  it("allows git commit on a feature branch", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput('git commit -m "x"', featRepo));
    expect(r.status).toBe(0);
    expect(denyReason(r)).toBeUndefined();
  });

  it("allows git commit on main when YUI_ALLOW_MAIN=1", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput('git commit -m "x"', mainRepo), {
      YUI_ALLOW_MAIN: "1",
    });
    expect(denyReason(r)).toBeUndefined();
  });

  it("allows read-only git commands on main", () => {
    for (const cmd of ["git status", "git log --oneline", "git diff"]) {
      expect(
        denyReason(runHook("pretool-bash-guard.sh", bashInput(cmd, mainRepo))),
      ).toBeUndefined();
    }
  });
});

describe("pretool-bash-guard.sh — secret guard", () => {
  it("denies reading .env.local via cat", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput("cat .env.local", featRepo));
    expect(denyReason(r)).toMatch(/\.env\.local/);
  });

  it("denies grep against an absolute .env.local path", () => {
    const r = runHook(
      "pretool-bash-guard.sh",
      bashInput("grep KEY /Users/x/YUI/.env.local", featRepo),
    );
    expect(denyReason(r)).toMatch(/\.env\.local/);
  });

  it("allows copying .env.local (worktree setup path)", () => {
    const r = runHook(
      "pretool-bash-guard.sh",
      bashInput("cp ../YUI/.env.local .env.local", featRepo),
    );
    expect(denyReason(r)).toBeUndefined();
  });
});

describe("pretool-bash-guard.sh — purchased_motions guard", () => {
  const mutating = [
    "rm resources/purchased_motions/考え中ループ.anim",
    "mv resources/purchased_motions/a.anim resources/vrma/a.anim",
    "cp resources/purchased_motions/a.anim /tmp/a.anim",
    "rsync -a resources/purchased_motions/ /tmp/dst/",
    "sed -i '' 's/x/y/' resources/purchased_motions/a.anim",
    "git add resources/purchased_motions/a.anim",
    "git rm resources/purchased_motions/a.anim",
    "echo data > resources/purchased_motions/a.anim",
  ];
  for (const cmd of mutating) {
    it(`denies: ${cmd}`, () => {
      expect(denyReason(runHook("pretool-bash-guard.sh", bashInput(cmd, featRepo)))).toMatch(
        /purchased_motions/,
      );
    });
  }

  it("mentions the YUI_ALLOW_MOTIONS bypass", () => {
    const r = runHook(
      "pretool-bash-guard.sh",
      bashInput("rm resources/purchased_motions/a.anim", featRepo),
    );
    expect(denyReason(r)).toMatch(/YUI_ALLOW_MOTIONS=1/);
  });

  it("allows reads of purchased_motions (cat/ls/grep)", () => {
    for (const cmd of [
      "cat resources/purchased_motions/AGENTS.md",
      "ls resources/purchased_motions",
      "grep -r foo resources/purchased_motions",
    ]) {
      expect(
        denyReason(runHook("pretool-bash-guard.sh", bashInput(cmd, featRepo))),
      ).toBeUndefined();
    }
  });

  it("does not flag commands unrelated to purchased_motions", () => {
    expect(
      denyReason(runHook("pretool-bash-guard.sh", bashInput("rm resources/vrma/a.anim", featRepo))),
    ).toBeUndefined();
  });

  it("allows mutation when YUI_ALLOW_MOTIONS=1", () => {
    const r = runHook(
      "pretool-bash-guard.sh",
      bashInput("rm resources/purchased_motions/a.anim", featRepo),
      { YUI_ALLOW_MOTIONS: "1" },
    );
    expect(denyReason(r)).toBeUndefined();
  });
});

describe("pretool-bash-guard.sh — fail-open", () => {
  it("exits 0 with no output on malformed input", () => {
    const r = runHook("pretool-bash-guard.sh", "not-json{{{");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });

  it("exits 0 when cwd is not a git repository", () => {
    const r = runHook("pretool-bash-guard.sh", bashInput('git commit -m "x"', tmpdir()));
    expect(r.status).toBe(0);
  });
});

describe("pretool-read-guard.sh", () => {
  function readInput(file_path: string) {
    return { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path } };
  }

  it("denies reading .env.local", () => {
    const r = runHook("pretool-read-guard.sh", readInput("/Users/x/YUI/.env.local"));
    expect(r.status).toBe(0);
    expect(denyReason(r)).toMatch(/\.env\.local/);
  });

  it("allows other files", () => {
    const r = runHook("pretool-read-guard.sh", readInput("/Users/x/YUI/src/main.ts"));
    expect(denyReason(r)).toBeUndefined();
  });

  it("fails open on malformed input", () => {
    const r = runHook("pretool-read-guard.sh", "{{{");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

const PROJECT = "/Users/me/YUI";

function editInput(file_path: string, text: string, tool: "Write" | "Edit" = "Edit") {
  const tool_input =
    tool === "Write"
      ? { file_path, content: text }
      : { file_path, new_string: text, old_string: "" };
  return { cwd: PROJECT, hook_event_name: "PostToolUse", tool_name: tool, tool_input };
}

function blockReason(r: HookResult): string | undefined {
  if (!r.stdout.trim()) return undefined;
  const parsed = JSON.parse(r.stdout);
  if (parsed.decision !== "block") return undefined;
  return parsed.reason as string;
}

function additionalContext(r: HookResult): string | undefined {
  if (!r.stdout.trim()) return undefined;
  return JSON.parse(r.stdout).hookSpecificOutput?.additionalContext as string | undefined;
}

describe("pretool-write-guard.sh — purchased_motions guard", () => {
  function writeInput(file_path: string) {
    return {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path, content: "x" },
    };
  }

  it("denies writing inside purchased_motions (absolute path)", () => {
    const r = runHook(
      "pretool-write-guard.sh",
      writeInput("/Users/x/YUI/resources/purchased_motions/a.anim"),
    );
    expect(r.status).toBe(0);
    expect(denyReason(r)).toMatch(/purchased_motions/);
  });

  it("denies a relative purchased_motions path", () => {
    const r = runHook("pretool-write-guard.sh", writeInput("resources/purchased_motions/a.anim"));
    expect(denyReason(r)).toMatch(/purchased_motions/);
  });

  it("allows other files", () => {
    const r = runHook("pretool-write-guard.sh", writeInput("/Users/x/YUI/resources/vrma/a.anim"));
    expect(denyReason(r)).toBeUndefined();
  });

  it("allows writes when YUI_ALLOW_MOTIONS=1", () => {
    const r = runHook("pretool-write-guard.sh", writeInput("resources/purchased_motions/a.anim"), {
      YUI_ALLOW_MOTIONS: "1",
    });
    expect(denyReason(r)).toBeUndefined();
  });

  it("fails open on malformed input", () => {
    const r = runHook("pretool-write-guard.sh", "{{{");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});

describe("posttool-edit-guard.sh — docs vocabulary guard", () => {
  it("blocks change-narrative vocabulary in docs markdown", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(`${PROJECT}/docs/motions.md`, "이 필드는 더 이상 사용되지 않는다."),
    );
    expect(r.status).toBe(0);
    expect(blockReason(r)).toMatch(/더 이상/);
  });

  it("blocks past-tense change narration written via Write", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(
        `${PROJECT}/docs/motions.md`,
        "기존 핸들러를 제거했다. 새 경로로 대체했다.",
        "Write",
      ),
    );
    expect(blockReason(r)).toBeDefined();
  });

  it("allows current-state declarative docs", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(`${PROJECT}/docs/motions.md`, "Emotion id는 vrm_expression으로 매핑된다."),
    );
    expect(blockReason(r)).toBeUndefined();
  });

  it("skips lines quoting the rule's own vocabulary list", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(`${PROJECT}/AGENTS.md`, 'no "was X, now Y", no 제거/대체/축소/supersede 문구'),
    );
    expect(blockReason(r)).toBeUndefined();
  });

  it("does not apply to non-markdown files", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(`${PROJECT}/src/main.ts`, "// 더 이상 사용되지 않는다"),
    );
    expect(blockReason(r)).toBeUndefined();
  });
});

describe("posttool-edit-guard.sh — motions doc sync nudge", () => {
  it("nudges docs/motions.md when configs/motions.json changes", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(`${PROJECT}/configs/motions.json`, '{ "id": "wave" }', "Write"),
    );
    expect(additionalContext(r)).toMatch(/docs\/motions\.md/);
  });

  it("stays silent for unrelated files", () => {
    const r = runHook(
      "posttool-edit-guard.sh",
      editInput(`${PROJECT}/src/renderer/index.ts`, "const a = 1;"),
    );
    expect(r.stdout.trim()).toBe("");
  });
});

describe("posttool-edit-guard.sh — fail-open", () => {
  it("exits 0 with no output on malformed input", () => {
    const r = runHook("posttool-edit-guard.sh", "{{{");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("");
  });
});
