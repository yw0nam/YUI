import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const SCRIPT = join(ROOT, "integrations/skills/yui-daily-briefing/scripts/post-briefing.py");
const LOOPBACK = "127.0.0.1";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BODY_LIMIT = 49152;

type Received = { path: string; contentType: string; payload: string };
type Result = { status: number | null; stdout: string; stderr: string };

// spawnSync would block the event loop that serves the ingress below.
function runScript(base: string, stdin: string, args: string[] = []): Promise<Result> {
  return new Promise((done) => {
    const child = spawn("python3", [SCRIPT, ...args], {
      env: { ...process.env, YUI_SIGNALS_URL: base, NO_PROXY: "*", no_proxy: "*" },
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

async function closedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((listening) => probe.listen(0, LOOPBACK, listening));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((closed) => probe.close(() => closed()));
  return port;
}

describe("post-briefing.py", () => {
  it("caps the item read from stdin and posts it under the day's envelope", async () => {
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

    await withIngress(200, async (base, received) => {
      const result = await runScript(base, stdin, ["--event-id", "daily-briefing:2026-09-11"]);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(received).toHaveLength(1);
      expect(received[0].path).toBe("/signals");
      expect(received[0].contentType).toBe("application/json");

      const request = JSON.parse(received[0].payload);
      const item = request.signals[0];
      expect(item.skill).toBe("yui-daily-briefing");
      expect(item.summary).toBe("30 items");
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
        source: "cron",
        event_type: "daily_briefing",
        delivery: "immediate",
        event_id: "daily-briefing:2026-09-11",
        occurred_at: expect.any(Number),
      });
    });
  });

  it("skips the morning when the ingress refuses the connection", async () => {
    const port = await closedPort();
    const stdin = JSON.stringify({
      sources: [{ name: "papers", status: "ok" }],
      refs: [{ kind: "paper", title: "a ref", url: "https://example.com/a" }],
    });
    const result = await runScript(`http://${LOOPBACK}:${port}`, stdin);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("yui unreachable");
  });

  it("names the rejected status and exits 1 on a non-2xx answer", async () => {
    const stdin = JSON.stringify({
      sources: [{ name: "papers", status: "ok" }],
      refs: [{ kind: "paper", title: "a ref", url: "https://example.com/a" }],
    });
    await withIngress(500, async (base, received) => {
      const result = await runScript(base, stdin);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("yui answered 500");
      expect(received).toHaveLength(1);
    });
  });

  it("reports malformed input as a failed source and exits 1", async () => {
    await withIngress(200, async (base, received) => {
      const result = await runScript(base, JSON.stringify({ sources: "nope", refs: [] }), [
        "--source",
        "morning",
      ]);
      expect(result.status).toBe(1);
      expect(received).toHaveLength(1);
      const request = JSON.parse(received[0].payload);
      expect(request.envelope.event_type).toBe("source_health");
      expect(request.envelope.event_id).toMatch(/^source-health:morning:\d+$/);
      expect(request.signals[0].sources).toEqual([{ name: "morning", status: "failed" }]);
      expect(request.signals[0].refs).toEqual([]);
    });
  });

  it("prints the request without posting it on a dry run, dropping refs to fit the body cap", async () => {
    const refs = Array.from({ length: 30 }, (_, index) => ({
      kind: "paper",
      url: `https://example.com/${String(index).padStart(4, "0")}/${"u".repeat(1975)}`,
      at: "2026-09-11T04:00:00Z",
      excerpt: "e".repeat(280),
    }));
    expect(refs[0].url).toHaveLength(2000);

    await withIngress(200, async (base, received) => {
      const result = await runScript(base, JSON.stringify({ sources: [], refs }), ["--dry-run"]);
      expect(result.status).toBe(0);
      expect(received).toHaveLength(0);
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
