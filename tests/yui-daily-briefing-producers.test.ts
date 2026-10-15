import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { marked } from "marked";
import { describe, expect, it, vi } from "vitest";
import { PYTHON } from "./command-paths";

vi.setConfig({ testTimeout: 15_000 });

const ROOT = resolve(__dirname, "..");
const SKILL_DIR = join(ROOT, "integrations/skills/yui-daily-briefing");
const SCRIPT = join(SKILL_DIR, "scripts/briefing.py");
const GATHER = JSON.parse(readFileSync(join(SKILL_DIR, "assets/fixtures/gather.json"), "utf8"));
const TEMPLATE = readFileSync(join(SKILL_DIR, "assets/report.html"), "utf8");
const FILLED = readFileSync(join(SKILL_DIR, "assets/fixtures/report-filled.html"), "utf8");
const BRIEFING = /^reports\/\d{4}\/\d{2}\/W[1-5]\/\d{2}\/[^/]+$/;
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

type Result = { status: number | null; stdout: string; stderr: string };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "yui-briefing-"));
}

function run(spool: string, args: string[], stdin = ""): Result {
  const result = spawnSync(PYTHON, [SCRIPT, "--spool", spool, ...args], {
    input: stdin,
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runAsync(spool: string, source: string, input: unknown): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn(PYTHON, [SCRIPT, "--spool", spool, "write", "--source", source]);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

async function holdLockOnWindows(spool: string): Promise<() => void> {
  if (process.platform !== "win32") return () => {};
  const probe = [
    "import importlib.util, sys, time",
    "spec = importlib.util.spec_from_file_location('briefing', sys.argv[2])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "with module.lock(sys.argv[1]):",
    "    print('locked', flush=True)",
    "    time.sleep(11)",
  ].join("\n");
  const child = spawn(PYTHON, ["-c", probe, spool, SCRIPT]);
  await new Promise<void>((resolve, reject) => {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (chunk.includes("locked")) resolve();
    });
    child.on("error", reject);
  });
  return () => child.kill();
}

function write(spool: string, source: string, input: unknown): Result {
  const stdin = typeof input === "string" ? input : JSON.stringify(input);
  return run(spool, ["write", "--source", source], stdin);
}

// Runs `write` with the helper's clock stopped at 08:00 local time on the given day.
function writeOn(spool: string, day: string, source: string, input: unknown): Result {
  const frozen = [
    "import datetime, importlib.util, sys, types",
    "spec = importlib.util.spec_from_file_location('briefing', sys.argv[1])",
    "module = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(module)",
    "year, month, day = map(int, sys.argv[2].split('-'))",
    "class Frozen(datetime.datetime):",
    "    @classmethod",
    "    def now(cls, tz=None):",
    "        return datetime.datetime(year, month, day, 8).astimezone()",
    "module.datetime = types.SimpleNamespace(datetime=Frozen, date=datetime.date)",
    "sys.argv = ['briefing.py', *sys.argv[3:]]",
    "sys.exit(module.main())",
  ].join("\n");
  const result = spawnSync(
    PYTHON,
    ["-B", "-c", frozen, SCRIPT, day, "--spool", spool, "write", "--source", source],
    { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8" },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function filesUnder(root: string, dir = ""): string[] {
  if (!existsSync(join(root, dir))) return [];
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = dir ? `${dir}/${entry.name}` : entry.name;
    return entry.isDirectory() ? filesUnder(root, path) : [path];
  });
}

function spoolFiles(spool: string): string[] {
  return filesUnder(spool, "reports")
    .filter((path) => BRIEFING.test(path))
    .sort();
}

function dayOf(path: string): string {
  const [, year, month, , day] = path.split("/");
  return `${year}-${month}-${day}`;
}

function read(spool: string, path: string): string {
  return readFileSync(join(spool, path), "utf8");
}

function seed(spool: string, path: string, text: string | Buffer): void {
  mkdirSync(join(spool, path, ".."), { recursive: true });
  writeFileSync(join(spool, path), text);
}

function body(markdown: string): string {
  return markdown.slice(markdown.indexOf("\n---\n", 4) + 5);
}

describe("briefing.py write", () => {
  it("serializes concurrent writers and records both files in one ledger", async () => {
    const spool = tempDir();
    const release = await holdLockOnWindows(spool);
    try {
      const [first, second] = await Promise.all([
        runAsync(spool, "alpha", GATHER),
        runAsync(spool, "beta", GATHER),
      ]);
      expect(first.status).toBe(0);
      expect(second.status).toBe(0);

      const files = spoolFiles(spool);
      expect(files).toHaveLength(2);
      expect(run(spool, ["mark-spoken", ...files]).status).toBe(0);
      expect(Object.keys(JSON.parse(read(spool, "spoken.json")))).toEqual(files);
    } finally {
      release();
    }
  }, 30_000);

  it("writes a dated markdown briefing with front matter and capped, numbered, linked items", () => {
    const bulk = Array.from({ length: 31 }, (_, index) => ({
      kind: "news",
      title: `item ${index}`,
      url: `https://example.com/n/${index}`,
    }));
    const input = {
      sources: GATHER.sources,
      refs: [
        { kind: "news", title: "T".repeat(250), url: "https://example.com/long" },
        ...GATHER.refs,
        { kind: "news", title: "the same url again", url: GATHER.refs[0].url },
        { kind: "news", title: "wrong scheme", url: "ftp://example.com/c" },
        ...bulk,
      ],
    };
    const spool = tempDir();
    expect(write(spool, "news", input)).toEqual({ status: 0, stdout: "", stderr: "" });

    const [path] = spoolFiles(spool);
    expect(path).toMatch(/^reports\/\d{4}\/\d{2}\/W[1-5]\/\d{2}\/news\.md$/);
    const day = dayOf(path);
    const text = read(spool, path);
    const [, frontMatter] = text.split("---\n");
    const lines = frontMatter.trimEnd().split("\n");
    expect(lines[0]).toBe('source: "news"');
    expect(lines[1]).toBe(`date: "${day}"`);
    expect(JSON.parse(lines[2].slice("generated_at: ".length))).toMatch(LOCAL_ISO);
    expect(lines.slice(3)).toEqual([
      'summary: "34 items"', // counts the distinct refs the cap dropped
      "sources:",
      '  - {name: "example-wire", status: "ok", last_ok: "2026-10-02T04:05:21Z"}',
      '  - {name: "example-feed", status: "stale", last_ok: "2026-09-28T22:10:00Z", run_url: "https://scheduler.example.com/runs/231"}',
    ]);

    const html = marked.parse(body(text), { async: false });
    expect(html).toContain("<h1>34 items</h1>");
    const hrefs = [...html.matchAll(/<li><a href="([^"]+)">([^<]*)<\/a>/g)];
    expect(hrefs).toHaveLength(30);
    expect(hrefs[0][2]).toBe(`${"T".repeat(199)}…`);
    expect(new Set(hrefs.map((match) => match[1])).size).toBe(30);
    expect(hrefs.filter((match) => !match[1].startsWith("https://"))).toEqual([]);
    // The excerpt line appears only when the excerpt carries text.
    expect(body(text)).toContain(
      "3. [Diffusion policies for dexterous manipulation](<https://papers.example.com/abs/2609.01234>)\n   paper · 2026-10-01T05:24:26Z\n4. ",
    );

    expect(write(tempDir(), "../x", GATHER).status).toBe(2);
  });

  it("names the day folder by year, month, and week of the month", () => {
    const spool = tempDir();
    for (const day of ["2026-10-01", "2026-10-07", "2026-10-08", "2026-10-29", "2026-10-31"]) {
      expect(writeOn(spool, day, "news", GATHER)).toEqual({ status: 0, stdout: "", stderr: "" });
    }
    expect(spoolFiles(spool)).toEqual([
      "reports/2026/10/W1/01/news.md",
      "reports/2026/10/W1/07/news.md",
      "reports/2026/10/W2/08/news.md",
      "reports/2026/10/W5/29/news.md",
      "reports/2026/10/W5/31/news.md",
    ]);
    expect(read(spool, "reports/2026/10/W5/31/news.md")).toContain('date: "2026-10-31"');
  });

  it("renders a title holding brackets and a url holding parentheses as a working link", () => {
    const spool = tempDir();
    write(spool, "news", GATHER);
    const html = marked.parse(body(read(spool, spoolFiles(spool)[0])), { async: false });
    expect(html).toContain(
      '<a href="https://news.example.com/story_(rates)">Rates [update] rise again</a>',
    );
  });

  it("never changes a spoken file and overwrites an unspoken one", () => {
    const spool = tempDir();
    write(spool, "news", GATHER);
    const [path] = spoolFiles(spool);
    const spoken = read(spool, path);
    expect(run(spool, ["mark-spoken", path]).status).toBe(0);
    expect(write(spool, "news", { ...GATHER, summary: "second run" }).status).toBe(0);

    const [rerun, original] = spoolFiles(spool);
    expect(original).toBe(path);
    expect(rerun).toMatch(/^reports\/\d{4}\/\d{2}\/W[1-5]\/\d{2}\/news\.\d{12}\.md$/);
    expect(read(spool, path)).toBe(spoken);
    expect(read(spool, rerun)).toContain('summary: "second run"');
    // Later runs, in any second, replace or keep that unspoken rerun.
    const earlier = rerun.replace(/\d{12}\.md$/, "000001000000.md");
    renameSync(join(spool, rerun), join(spool, earlier));
    expect(write(spool, "news", "{").status).toBe(1);
    expect(write(spool, "news", { ...GATHER, summary: "third run" }).status).toBe(0);
    expect(spoolFiles(spool)).toEqual([earlier, path]);
    expect(read(spool, earlier)).toContain('summary: "third run"');

    const fresh = tempDir();
    write(fresh, "news", GATHER);
    write(fresh, "news", { ...GATHER, summary: "second run" });
    expect(spoolFiles(fresh)).toHaveLength(1);
    expect(read(fresh, spoolFiles(fresh)[0])).toContain('summary: "second run"');
  });

  it("turns control characters, noncharacters, and lone surrogates in the input into spaces", () => {
    const spool = tempDir();
    const input = {
      summary: "a\u0080b\u007fc￿d￾e",
      sources: [{ name: "wire", status: "ok", last_ok: "2026-10-02\u0085" }],
      refs: [{ title: "emoji \ud83d", url: "https://example.com/a" }],
    };
    expect(write(spool, "news", input)).toEqual({ status: 0, stdout: "", stderr: "" });
    const text = read(spool, spoolFiles(spool)[0]);
    expect(text).toContain('summary: "a b c d e"');
    expect(text).toContain('  - {name: "wire", status: "ok", last_ok: "2026-10-02"}');
    expect(text).toContain("1. [emoji](<https://example.com/a>)");
  });

  it("caps last_ok and at at 64 characters", () => {
    const spool = tempDir();
    const input = {
      sources: [{ name: "wire", status: "stale", last_ok: "8".repeat(100) }],
      refs: [{ kind: "news", url: "https://example.com/a", at: "9".repeat(100) }],
    };
    expect(write(spool, "news", input).status).toBe(0);
    const text = read(spool, spoolFiles(spool)[0]);
    expect(text).toContain(`last_ok: "${"8".repeat(63)}…"`);
    expect(text).toContain(`   news · ${"9".repeat(63)}…\n`);
  });

  it("writes a failed briefing for malformed input unless an unspoken one is already there", () => {
    const spool = tempDir();
    const failed = write(spool, "morning", "{");
    expect(failed.status).toBe(1);
    expect(failed.stderr.trim().split("\n")).toEqual([expect.stringContaining("JSONDecodeError")]);
    const text = read(spool, spoolFiles(spool)[0]);
    expect(text).toContain('summary: "morning run failed: JSONDecodeError: ');
    expect(text).toContain('  - {name: "morning", status: "failed"}');
    expect(body(text)).not.toMatch(/^1\. /m);

    const kept = tempDir();
    write(kept, "news", GATHER);
    const [path] = spoolFiles(kept);
    const valid = read(kept, path);
    expect(write(kept, "news", { sources: "nope", refs: [] }).status).toBe(1);
    expect(spoolFiles(kept)).toEqual([path]);
    expect(read(kept, path)).toBe(valid);
  });
});

describe("briefing.py pending and mark-spoken", () => {
  function seeded(): string {
    const spool = tempDir();
    seed(spool, "reports/2026/09/W5/30/papers.md", "papers\n");
    seed(spool, "reports/2026/10/W1/01/news.md", "news\n");
    seed(spool, "reports/2026/10/W1/01/arxiv.md", "arxiv\n");
    seed(spool, "reports/2026/09/W5/29/news.sent.json", "{}");
    seed(spool, "reports/abcd/10/W1/01/news.md", "not a day\n");
    seed(spool, "2026-10-01/old.md", "not migrated\n");
    seed(spool, "reports/2026/10/W1/01/zz.md", Buffer.from([0x7a, 0xff, 0x0a]));
    seed(
      spool,
      "spoken.json",
      JSON.stringify({ "reports/2026/09/W5/30/papers.md": "2026-09-30T08:00:00+02:00" }),
    );
    return spool;
  }

  it("prints every unspoken briefing in order under its path, and nothing once all are spoken", () => {
    const spool = seeded();
    expect(run(spool, ["pending"])).toEqual({
      status: 0,
      stdout:
        "=== reports/2026/10/W1/01/arxiv.md ===\narxiv\n\n=== reports/2026/10/W1/01/news.md ===\nnews\n\n=== reports/2026/10/W1/01/zz.md ===\nz�\n\n",
      stderr: "",
    });
    const all = [
      "reports/2026/10/W1/01/arxiv.md",
      "reports/2026/10/W1/01/news.md",
      "reports/2026/10/W1/01/zz.md",
    ];
    expect(run(spool, ["mark-spoken", ...all]).status).toBe(0);
    expect(run(spool, ["pending"]).stdout).toBe("");
  });

  it("exits 2 when neither --spool nor YUI_BRIEFING_SPOOL names the spool", () => {
    const env = { ...process.env };
    delete env.YUI_BRIEFING_SPOOL;
    const result = spawnSync(PYTHON, [SCRIPT, "pending"], { encoding: "utf8", env });
    expect(result.status).toBe(2);
    expect(result.stderr.trim().split("\n")).toEqual([
      expect.stringContaining("set YUI_BRIEFING_SPOOL or pass --spool"),
    ]);
  });

  it("exits 2 on a relative spool path, and on a missing spool when reading it", () => {
    expect(run("relative/spool", ["pending"]).status).toBe(2);
    const absent = join(tempDir(), "absent");
    for (const args of [["pending"], ["mark-spoken", "reports/2026/10/W1/01/news.md"]]) {
      const result = run(absent, args);
      expect(result.status).toBe(2);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("records each path with a local timestamp and rejects a path outside the spool's briefings", () => {
    const spool = seeded();
    expect(run(spool, ["mark-spoken", "reports/2026/10/W1/01/news.md"]).status).toBe(0);
    const ledger = JSON.parse(read(spool, "spoken.json"));
    expect(Object.keys(ledger)).toEqual([
      "reports/2026/09/W5/30/papers.md",
      "reports/2026/10/W1/01/news.md",
    ]);
    expect(ledger["reports/2026/10/W1/01/news.md"]).toMatch(LOCAL_ISO);

    const before = read(spool, "spoken.json");
    for (const bad of [
      "../reports/2026/10/W1/01/news.md",
      join(spool, "reports/2026/10/W1/01/arxiv.md"),
      "reports/2026/10/W1/01/gone.md",
      "2026-10-01/old.md",
    ]) {
      const result = run(spool, ["mark-spoken", "reports/2026/10/W1/01/arxiv.md", bad]);
      expect(result.status).toBe(2);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
      expect(read(spool, "spoken.json")).toBe(before);
    }
  });

  it("reads a corrupt ledger as empty, and mark-spoken alone sets it aside", () => {
    const spool = seeded();
    writeFileSync(join(spool, "spoken.json"), "{");
    expect(write(spool, "news", GATHER).status).toBe(0);
    expect(read(spool, "spoken.json")).toBe("{");
    expect(existsSync(join(spool, "spoken.json.bad"))).toBe(false);
    const result = run(spool, ["mark-spoken", "reports/2026/10/W1/01/news.md"]);
    expect(result.status).toBe(0);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(read(spool, "spoken.json.bad")).toBe("{");
    expect(Object.keys(JSON.parse(read(spool, "spoken.json")))).toEqual([
      "reports/2026/10/W1/01/news.md",
    ]);
  });
});

function git(dir: string, args: string[]): string {
  const result = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

function repo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.name", "YUI Test"]);
  git(dir, ["config", "user.email", "yui@example.com"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  return dir;
}

describe("briefing.py publish", () => {
  it("pushes the briefings and the .gitignore and nothing else, and makes no commit when nothing changed", () => {
    const origin = join(tempDir(), "origin.git");
    expect(spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin]).status).toBe(0);
    const spool = repo(tempDir());
    git(spool, ["remote", "add", "origin", origin]);
    expect(write(spool, "news", GATHER).status).toBe(0);
    const [path] = spoolFiles(spool);
    expect(run(spool, ["mark-spoken", path]).status).toBe(0);
    seed(spool, ".gitignore", "spoken.json\n.lock\n");
    seed(spool, "notes.txt", "private\n");
    git(spool, ["add", "notes.txt"]);

    expect(run(spool, ["publish"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(git(origin, ["ls-tree", "-r", "--name-only", "main"])).toBe(`.gitignore\n${path}\n`);
    expect(git(origin, ["log", "--format=%s", "main"])).toBe(`${dayOf(path)}\n`);

    expect(run(spool, ["publish"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(git(origin, ["rev-list", "--count", "main"])).toBe("1\n");
  });

  it("pushes the day pages with the board and the shared page assets once a day has a page", () => {
    const origin = join(tempDir(), "origin.git");
    expect(spawnSync("git", ["init", "-q", "--bare", "-b", "main", origin]).status).toBe(0);
    const spool = repo(tempDir());
    git(spool, ["remote", "add", "origin", origin]);
    expect(writeOn(spool, "2026-10-02", "news", GATHER).status).toBe(0);
    seed(spool, "reports/2026/10/W1/02/index.html", FILLED);
    seed(spool, "reports/2026/10/W1/02/draft.html", "not a page\n");
    seed(spool, "src/style.css", "stale copy\n");
    seed(spool, "README.md", "the user's\n");
    seed(spool, ".nojekyll", "");

    expect(run(spool, ["publish"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(git(origin, ["ls-tree", "-r", "--name-only", "main"]).split("\n")).toEqual([
      ".nojekyll",
      "index.html",
      "reports/2026/10/W1/02/index.html",
      "reports/2026/10/W1/02/news.md",
      "src/lang.js",
      "src/style.css",
      "",
    ]);
    expect(read(spool, "src/style.css")).toBe(
      readFileSync(join(SKILL_DIR, "assets/src/style.css"), "utf8"),
    );
    expect(read(spool, "index.html")).toContain('href="reports/2026/10/W1/02/"');
  });

  it("exits 2 on a spool that is not its own git work tree or has no remote", () => {
    const plain = tempDir();
    const nested = join(repo(tempDir()), "spool");
    const lone = repo(tempDir());
    for (const spool of [plain, nested, lone]) {
      expect(write(spool, "news", GATHER).status).toBe(0);
      const result = run(spool, ["publish"]);
      expect(result.status).toBe(2);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("exits 1 with git's fatal line when the push fails", () => {
    const spool = repo(tempDir());
    git(spool, ["remote", "add", "origin", join(tempDir(), "absent.git")]);
    expect(write(spool, "news", GATHER).status).toBe(0);
    const result = run(spool, ["publish"]);
    expect(result.status).toBe(1);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).toMatch(/^git push failed: fatal: /);
  });
});

describe("briefing.py migrate", () => {
  const STAMP = "2026-10-01T08:00:00+02:00";

  function oldSpool(): string {
    const spool = repo(tempDir());
    seed(spool, "2026-09-30/papers.md", "papers\n");
    seed(spool, "2026-10-01/news.md", "news\n");
    seed(spool, "2026-10-15/news.md", "news on the 15th\n");
    git(spool, ["add", "2026-09-30", "2026-10-01", "2026-10-15"]);
    git(spool, ["commit", "-q", "-m", "old layout"]);
    seed(spool, "2026-10-15/arxiv.md", "not published yet\n");
    seed(
      spool,
      "spoken.json",
      JSON.stringify({ "2026-09-30/papers.md": STAMP, "2026-10-01/news.md": STAMP }),
    );
    return spool;
  }

  function workFiles(spool: string): string[] {
    return filesUnder(spool)
      .filter((path) => !path.startsWith(".git/"))
      .sort();
  }

  it("moves old day folders under reports/, rewrites the ledger, keeps history, and changes nothing on a second run", () => {
    const spool = oldSpool();
    expect(run(spool, ["migrate"])).toEqual({ status: 0, stdout: "", stderr: "" });

    expect(workFiles(spool)).toEqual([
      ".lock",
      "reports/2026/09/W5/30/papers.md",
      "reports/2026/10/W1/01/news.md",
      "reports/2026/10/W3/15/arxiv.md",
      "reports/2026/10/W3/15/news.md",
      "spoken.json",
    ]);
    expect(JSON.parse(read(spool, "spoken.json"))).toEqual({
      "reports/2026/09/W5/30/papers.md": STAMP,
      "reports/2026/10/W1/01/news.md": STAMP,
    });
    expect(git(spool, ["ls-files"])).toBe(
      "reports/2026/09/W5/30/papers.md\nreports/2026/10/W1/01/news.md\nreports/2026/10/W3/15/news.md\n",
    );
    expect(
      git(spool, ["log", "--follow", "--format=%s", "--", "reports/2026/10/W1/01/news.md"]),
    ).toMatch(/\nold layout\n$/);
    expect(run(spool, ["pending"]).stdout).toBe(
      "=== reports/2026/10/W3/15/arxiv.md ===\nnot published yet\n\n=== reports/2026/10/W3/15/news.md ===\nnews on the 15th\n\n",
    );

    const commits = git(spool, ["rev-list", "--count", "HEAD"]);
    const ledger = read(spool, "spoken.json");
    expect(run(spool, ["migrate"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(workFiles(spool)).toHaveLength(6);
    expect(read(spool, "spoken.json")).toBe(ledger);
    expect(git(spool, ["rev-list", "--count", "HEAD"])).toBe(commits);
  });

  it("completes a run cut short after some moves: the rest moves, the ledger heals, one commit records it", () => {
    const spool = oldSpool();
    mkdirSync(join(spool, "reports/2026/09/W5/30"), { recursive: true });
    git(spool, ["mv", "2026-09-30/papers.md", "reports/2026/09/W5/30/papers.md"]);

    expect(run(spool, ["migrate"])).toEqual({ status: 0, stdout: "", stderr: "" });
    expect(Object.keys(JSON.parse(read(spool, "spoken.json")))).toEqual([
      "reports/2026/09/W5/30/papers.md",
      "reports/2026/10/W1/01/news.md",
    ]);
    expect(git(spool, ["ls-tree", "-r", "--name-only", "HEAD"])).toBe(
      "reports/2026/09/W5/30/papers.md\nreports/2026/10/W1/01/news.md\nreports/2026/10/W3/15/news.md\n",
    );
    expect(
      git(spool, ["log", "--follow", "--format=%s", "--", "reports/2026/09/W5/30/papers.md"]),
    ).toMatch(/\nold layout\n$/);
  });

  it("exits 2 and moves nothing when a file already sits at a new path", () => {
    const spool = tempDir();
    seed(spool, "2026-09-30/papers.md", "old\n");
    seed(spool, "2026-10-01/news.md", "old\n");
    seed(spool, "reports/2026/10/W1/01/news.md", "new\n");
    const result = run(spool, ["migrate"]);
    expect(result.status).toBe(2);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(read(spool, "2026-09-30/papers.md")).toBe("old\n");
    expect(read(spool, "reports/2026/10/W1/01/news.md")).toBe("new\n");
  });
});

describe("briefing.py board", () => {
  it("lists every day newest first with each producer's item count and its stale or failed flag", () => {
    const spool = tempDir();
    const quiet = { sources: [{ name: "wire", status: "ok" }], refs: GATHER.refs.slice(0, 1) };
    expect(writeOn(spool, "2026-09-30", "news", quiet).status).toBe(0);
    expect(writeOn(spool, "2026-10-02", "papers", quiet).status).toBe(0);
    expect(writeOn(spool, "2026-10-02", "news", GATHER).status).toBe(0);
    expect(writeOn(spool, "2026-10-02", "markets", "{").status).toBe(1);
    seed(spool, "reports/2026/10/W1/02/index.html", FILLED);

    expect(run(spool, ["board"])).toEqual({ status: 0, stdout: "", stderr: "" });
    const board = read(spool, "index.html");
    const rows = board.split('<li class="day">').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<a class="day-link" href="reports/2026/10/W1/02/">');
    expect(rows[0]).toContain('<span class="day-iso">2026-10-02</span>');
    expect(rows[0]).toContain('<span lang="en">Fri</span><span lang="ko">금</span>');
    expect(rows[0]).toContain(
      '<li class="flag-failed"><span class="p-name">markets</span> <span class="p-count">0</span></li>',
    );
    expect(rows[0]).toContain(
      '<li class="flag-stale"><span class="p-name">news</span> <span class="p-count">2</span></li>',
    );
    expect(rows[0]).toContain(
      '<li><span class="p-name">papers</span> <span class="p-count">1</span></li>',
    );
    expect(rows[0]).toContain('class="status status-failed"');
    expect(rows[1]).toContain('<span class="day-iso">2026-09-30</span>');
    // A day without a page is listed with no link.
    expect(rows[1]).not.toContain("<a ");
    expect(rows[1]).not.toContain("status-");

    expect(run(spool, ["board"]).status).toBe(0);
    expect(read(spool, "index.html")).toBe(board);
  });
});

describe("briefing.py page-check", () => {
  const PAGE = "reports/2026/10/W1/02/index.html";

  function check(page: string | null): Result {
    const spool = tempDir();
    if (page !== null) seed(spool, PAGE, page);
    return run(spool, ["page-check", "2026-10-02"]);
  }

  function failure(page: string | null): string {
    const result = check(page);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    return result.stderr.trim();
  }

  it("passes a page whose every required slot is filled in every language it offers", () => {
    expect(check(FILLED)).toEqual({ status: 0, stdout: "", stderr: "" });
    const quiet = FILLED.replace(
      /<!-- slot: notices -->[\s\S]*?<!-- \/slot -->/,
      "<!-- slot: notices --><!-- /slot -->",
    );
    expect(check(quiet).status).toBe(0);
  });

  it("names the first slot still holding the template's marker, or missing, or a missing page", () => {
    expect(failure(TEMPLATE)).toMatch(/\btitle\b/);
    expect(
      failure(FILLED.replace(/<!-- slot: summary lang=ko -->[\s\S]*?<!-- \/slot -->/, "")),
    ).toMatch(/summary lang=ko/);
    expect(
      failure(
        FILLED.replace(
          /(<!-- slot: intro:papers lang=ko -->)[\s\S]*?(<!-- \/slot -->)/,
          "$1<!-- fill -->$2",
        ),
      ),
    ).toMatch(/intro:papers lang=ko/);
    expect(failure(null)).toContain(PAGE);
  });
});
