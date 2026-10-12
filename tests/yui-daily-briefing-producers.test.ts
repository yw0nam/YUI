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

vi.setConfig({ testTimeout: 15_000 });

const ROOT = resolve(__dirname, "..");
const SKILL_DIR = join(ROOT, "integrations/skills/yui-daily-briefing");
const SCRIPT = join(SKILL_DIR, "scripts/briefing.py");
const PYTHON = process.platform === "win32" ? "py" : "python3";
const GATHER = JSON.parse(readFileSync(join(SKILL_DIR, "assets/fixtures/gather.json"), "utf8"));
const DAY = /^\d{4}-\d{2}-\d{2}$/;
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

function spoolFiles(spool: string): string[] {
  if (!existsSync(spool)) return [];
  return readdirSync(spool)
    .filter((day) => DAY.test(day))
    .flatMap((day) => readdirSync(join(spool, day)).map((name) => `${day}/${name}`))
    .sort();
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
    expect(path).toMatch(/^\d{4}-\d{2}-\d{2}\/news\.md$/);
    const day = path.split("/")[0];
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
    expect(rerun).toMatch(/^\d{4}-\d{2}-\d{2}\/news\.\d{12}\.md$/);
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
    seed(spool, "2026-09-30/papers.md", "papers\n");
    seed(spool, "2026-10-01/news.md", "news\n");
    seed(spool, "2026-10-01/arxiv.md", "arxiv\n");
    seed(spool, "2026-09-29/news.sent.json", "{}");
    seed(spool, "abcd-ef-gh/news.md", "not a day\n");
    seed(spool, "2026-10-01/zz.md", Buffer.from([0x7a, 0xff, 0x0a]));
    seed(
      spool,
      "spoken.json",
      JSON.stringify({ "2026-09-30/papers.md": "2026-09-30T08:00:00+02:00" }),
    );
    return spool;
  }

  it("prints every unspoken briefing in order under its path, and nothing once all are spoken", () => {
    const spool = seeded();
    expect(run(spool, ["pending"])).toEqual({
      status: 0,
      stdout:
        "=== 2026-10-01/arxiv.md ===\narxiv\n\n=== 2026-10-01/news.md ===\nnews\n\n=== 2026-10-01/zz.md ===\nz�\n\n",
      stderr: "",
    });
    const all = ["2026-10-01/arxiv.md", "2026-10-01/news.md", "2026-10-01/zz.md"];
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
    for (const args of [["pending"], ["mark-spoken", "2026-10-01/news.md"]]) {
      const result = run(absent, args);
      expect(result.status).toBe(2);
      expect(result.stderr.trim().split("\n")).toHaveLength(1);
    }
  });

  it("records each path with a local timestamp and rejects a path outside the spool's briefings", () => {
    const spool = seeded();
    expect(run(spool, ["mark-spoken", "2026-10-01/news.md"]).status).toBe(0);
    const ledger = JSON.parse(read(spool, "spoken.json"));
    expect(Object.keys(ledger)).toEqual(["2026-09-30/papers.md", "2026-10-01/news.md"]);
    expect(ledger["2026-10-01/news.md"]).toMatch(LOCAL_ISO);

    const before = read(spool, "spoken.json");
    for (const bad of [
      "../2026-10-01/news.md",
      join(spool, "2026-10-01/arxiv.md"),
      "2026-10-01/gone.md",
    ]) {
      const result = run(spool, ["mark-spoken", "2026-10-01/arxiv.md", bad]);
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
    const result = run(spool, ["mark-spoken", "2026-10-01/news.md"]);
    expect(result.status).toBe(0);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(read(spool, "spoken.json.bad")).toBe("{");
    expect(Object.keys(JSON.parse(read(spool, "spoken.json")))).toEqual(["2026-10-01/news.md"]);
  });
});
