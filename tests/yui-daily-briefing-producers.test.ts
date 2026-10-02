import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SCRIPT = join(ROOT, "integrations/skills/yui-daily-briefing/scripts/post-briefing.py");
const LOOPBACK = "127.0.0.1";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const BODY_LIMIT = 49152;

type Received = { path: string; contentType: string; payload: string };
type Result = { status: number | null; stdout: string; stderr: string };

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "yui-briefing-"));
}

// spawnSync would block the event loop that serves the ingress below.
// A temp HOME keeps the default spool out of the real home directory.
function runScript(base: string, stdin: string, args: string[], spool: string): Promise<Result> {
  return new Promise((done) => {
    const child = spawn("python3", [SCRIPT, "--spool", spool, ...args], {
      env: { ...process.env, HOME: tempDir(), YUI_SIGNALS_URL: base, NO_PROXY: "*", no_proxy: "*" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => done({ status, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

async function withIngress(
  status: number,
  run: (base: string, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      received.push({
        path: request.url ?? "",
        contentType: String(request.headers["content-type"] ?? ""),
        payload: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((listening) => server.listen(0, LOOPBACK, listening));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://${LOOPBACK}:${port}`, received);
  } finally {
    await new Promise<void>((closed) => server.close(() => closed()));
  }
}

// A tunnel with no YUI behind its far end accepts the request and hangs up unanswered.
async function withSilentHangup(run: (base: string) => Promise<void>): Promise<void> {
  const server = createTcpServer((socket) => socket.once("data", () => socket.end()));
  await new Promise<void>((listening) => server.listen(0, LOOPBACK, listening));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://${LOOPBACK}:${port}`);
  } finally {
    await new Promise<void>((closed) => server.close(() => closed()));
  }
}

async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((listening) => probe.listen(0, LOOPBACK, listening));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((closed) => probe.close(() => closed()));
  return port;
}

function spoolFiles(spool: string): string[] {
  return readdirSync(spool)
    .filter((day) => DAY.test(day))
    .flatMap((day) => readdirSync(join(spool, day)).map((name) => `${day}/${name}`))
    .sort();
}

const ONE_REF = JSON.stringify({
  sources: [{ name: "papers", status: "ok" }],
  refs: [{ kind: "paper", title: "a ref", url: "https://example.com/a" }],
});

describe("post-briefing.py", () => {
  it("caps the item, spools it under the day, posts it, and marks it sent", async () => {
    const bulk = Array.from({ length: 31 }, (_, index) => ({
      kind: "news",
      title: `item ${index}`,
      url: `https://example.com/n/${index}`,
      at: "2026-09-11T04:00:00Z",
      excerpt: "",
    }));
    const stdin = JSON.stringify({
      sources: [{ name: "papers", status: "ok", last_ok: "2026-09-11T06:00:00+09:00" }],
      refs: [
        {
          kind: "paper",
          title: "T".repeat(250),
          url: "https://example.com/a",
          at: "2026-09-11T05:24:26Z",
          excerpt: "an abstract",
        },
        { kind: "paper", title: "the same url again", url: "https://example.com/a" },
        { url: "https://example.com/b" },
        { kind: "paper", title: "wrong scheme", url: "ftp://example.com/c" },
        ...bulk,
      ],
    });
    const spool = tempDir();

    await withIngress(200, async (base, received) => {
      const result = await runScript(base, stdin, ["--source", "papers"], spool);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(received).toHaveLength(1);
      expect(received[0].path).toBe("/signals");
      expect(received[0].contentType).toBe("application/json");

      const request = JSON.parse(received[0].payload);
      expect(request.signals).toHaveLength(1);
      const item = request.signals[0];
      expect(item.skill).toBe("yui-daily-briefing");
      expect(item.date).toMatch(DAY);
      expect(item.summary).toBe("33 items"); // counts the refs the cap dropped
      expect(item.refs).toHaveLength(30);
      const urls = item.refs.map((ref: any) => ref.url);
      expect(new Set(urls).size).toBe(30);
      expect(urls.filter((url: string) => !url.startsWith("https://"))).toEqual([]);
      expect(item.refs[0].title).toHaveLength(200);
      expect(item.refs[0].title.endsWith("…")).toBe(true);
      expect(item.refs[1].url).toBe("https://example.com/b");
      expect(item.refs[1].kind).toBe("other");
      expect(item.refs[1].title).toBe("https://example.com/b");
      expect(item.refs[1].at).toMatch(ISO);
      expect(request.envelope).toEqual({
        source: "papers",
        event_type: "daily_briefing",
        delivery: "immediate",
        event_id: `daily-briefing:${item.date}`,
        occurred_at: expect.any(Number),
      });
      expect(spoolFiles(spool)).toEqual([`${item.date}/papers.sent.json`]);
      const archived = readFileSync(join(spool, item.date, "papers.sent.json"), "utf8");
      expect(JSON.parse(archived)).toEqual(item);
    });
  });

  it("keeps the item pending while YUI is closed or hangs up, and a later flush delivers it", async () => {
    const spool = tempDir();
    const refused = await runScript(
      `http://${LOOPBACK}:${await closedPort()}`,
      ONE_REF,
      ["--source", "papers"],
      spool,
    );
    expect(refused.status).toBe(0);
    expect(refused.stderr).toContain("yui unreachable");
    const [pending] = spoolFiles(spool);
    expect(pending).toMatch(/^\d{4}-\d{2}-\d{2}\/papers\.json$/);

    await withSilentHangup(async (base) => {
      const hungUp = await runScript(base, "", ["--flush"], spool);
      expect(hungUp.status).toBe(0);
      expect(hungUp.stderr).toContain("yui unreachable");
    });
    expect(spoolFiles(spool)).toEqual([pending]);

    await withIngress(204, async (base, received) => {
      const flushed = await runScript(base, "", ["--flush"], spool);
      expect(flushed.status).toBe(0);
      expect(flushed.stderr).toBe("");
      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0].payload).signals[0].refs[0].url).toBe("https://example.com/a");
    });
    expect(spoolFiles(spool)).toEqual([pending.replace(".json", ".sent.json")]);
  });

  it("flushes every pending day in one group, oldest first, under the newest day's id", async () => {
    const spool = tempDir();
    const item = (date: string, name: string) => ({
      skill: "yui-daily-briefing",
      date,
      summary: `${name} on ${date}`,
      sources: [{ name, status: "ok" }],
      refs: [],
    });
    for (const [date, file] of [
      ["2026-09-09", "news.sent.json"],
      ["2026-09-10", "news.json"],
      ["2026-09-11", "papers.json"],
    ]) {
      mkdirSync(join(spool, date), { recursive: true });
      writeFileSync(join(spool, date, file), JSON.stringify(item(date, file.split(".")[0])));
    }

    await withIngress(200, async (base, received) => {
      const result = await runScript(base, "", ["--flush"], spool);
      expect(result.status).toBe(0);
      expect(received).toHaveLength(1);
      const request = JSON.parse(received[0].payload);
      expect(request.signals.map((signal: any) => signal.summary)).toEqual([
        "news on 2026-09-10",
        "papers on 2026-09-11",
      ]);
      expect(request.envelope.source).toBe("cron");
      expect(request.envelope.event_id).toBe("daily-briefing:2026-09-11");
    });
    expect(spoolFiles(spool)).toEqual([
      "2026-09-09/news.sent.json",
      "2026-09-10/news.sent.json",
      "2026-09-11/papers.sent.json",
    ]);
  });

  it("names the rejected status, exits 1, and keeps the item pending on a non-2xx answer", async () => {
    const spool = tempDir();
    await withIngress(500, async (base, received) => {
      const result = await runScript(base, ONE_REF, ["--source", "papers"], spool);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("yui answered 500");
      expect(received).toHaveLength(1);
    });
    expect(spoolFiles(spool)).toEqual([expect.stringMatching(/\/papers\.json$/)]);
  });

  it("spools malformed input as a failed source, delivers it, and exits 1", async () => {
    const spool = tempDir();
    const malformed = JSON.stringify({ sources: "nope", refs: [] });
    await withIngress(200, async (base, received) => {
      const result = await runScript(base, malformed, ["--source", "morning"], spool);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("ValueError");
      expect(received).toHaveLength(1);
      const request = JSON.parse(received[0].payload);
      expect(request.envelope.event_type).toBe("daily_briefing");
      const item = request.signals[0];
      expect(item.summary).toMatch(/^morning run failed: ValueError: /);
      expect(item.sources).toEqual([{ name: "morning", status: "failed" }]);
      expect(item.refs).toEqual([]);
      expect(spoolFiles(spool)).toEqual([`${item.date}/morning.sent.json`]);
    });
  });

  it("prints the group without spooling or posting it on a dry run, dropping refs to fit the body cap", async () => {
    const refs = Array.from({ length: 30 }, (_, index) => ({
      kind: "paper",
      url: `https://example.com/${String(index).padStart(4, "0")}/${"u".repeat(1975)}`,
      at: "2026-09-11T04:00:00Z",
      excerpt: "e".repeat(280),
    }));
    expect(refs[0].url).toHaveLength(2000);
    const spool = tempDir();

    await withIngress(200, async (base, received) => {
      const stdin = JSON.stringify({ sources: [], refs });
      const result = await runScript(base, stdin, ["--dry-run"], spool);
      expect(result.status).toBe(0);
      expect(received).toHaveLength(0);
      expect(spoolFiles(spool)).toEqual([]);
      expect(Buffer.byteLength(result.stdout.trim())).toBeLessThanOrEqual(BODY_LIMIT);
      const item = JSON.parse(result.stdout).signals[0];
      expect(item.refs.length).toBeGreaterThan(0);
      expect(item.refs.length).toBeLessThan(refs.length);
      for (const ref of item.refs) {
        expect(ref.title.length).toBeLessThanOrEqual(200);
      }
    });
  });
});
