import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

const SCRIPT = join(
  ROOT,
  "integrations/daily-assist/skills/yui-daily-briefing-setup/scripts/daily-briefing.py",
);
const TEMPLATE =
  "integrations/daily-assist/skills/yui-daily-briefing-setup/references/n8n-daily-briefing.template.json";
const LOOPBACK = "127.0.0.1";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

type Row = Record<string, unknown>;

let queueDir: string;

beforeEach(() => {
  queueDir = mkdtempSync(join(tmpdir(), "yui-briefing-"));
});

afterEach(() => {
  rmSync(queueDir, { recursive: true, force: true });
});

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function writeQueue(rows: Row[]): string {
  const path = join(queueDir, "queue.jsonl");
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
  return path;
}

// spawnSync would block the event loop that serves the ingress above.
function runScript(args: string[]) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn("python3", [SCRIPT, ...args], {
      env: { ...process.env, NO_PROXY: "*", no_proxy: "*" },
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
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

async function withIngress(
  status: number,
  run: (port: number, received: string[]) => Promise<void>,
) {
  const received: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk as Buffer));
    request.on("end", () => {
      received.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(port, received);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function queueRow(
  key: string,
  createdAt: string,
  status: string,
  source: string,
  payload: unknown,
  sentAt: string | null = null,
): Row {
  return {
    id: key,
    key,
    source,
    priority: "digest",
    payload: JSON.stringify(payload),
    status,
    createdAt,
    sent_at: sentAt,
  };
}

describe("daily-briefing.py", () => {
  it("marks rows sent on a 2xx and the body follows the contract", async () => {
    const prUrl = "https://github.com/yw0nam/YUI/pull/887";
    const rows = [
      queueRow("pr-new", "2026-09-11T09:00:00.000Z", "pending", "repo-status", {
        source: "github_pr",
        title: "feat: open speech-bubble links in the default browser",
        url: prUrl,
        updated_at: "2026-09-11T09:00:00.000Z",
      }),
      queueRow("issue-new", "2026-09-11T08:00:00.000Z", "pending", "repo-status", {
        source: "github_issue",
        title: "Daily briefing skills",
        url: "https://github.com/yw0nam/YUI/issues/876",
        updated_at: "2026-09-11T08:00:00.000Z",
      }),
      queueRow("mail-new", "2026-09-11T07:00:00.000Z", "pending", "gmail", {
        source: "gmail",
        thread_id: "thread-abc",
        subject: "Weekly build report",
        snippet: "The nightly build finished with three warnings.",
        date: "2026-09-11T07:00:00.000Z",
      }),
      queueRow("pr-old", "2026-09-11T06:00:00.000Z", "pending", "repo-status", {
        source: "github_pr",
        title: "feat: open speech-bubble links in the default browser",
        url: prUrl,
        updated_at: "2026-09-11T06:00:00.000Z",
      }),
      queueRow(
        "pr-spoken",
        "2026-09-10T05:00:00.000Z",
        "sent",
        "repo-status",
        {
          source: "github_pr",
          title: "chore: already spoken",
          url: "https://github.com/yw0nam/YUI/pull/870",
          updated_at: "2026-09-10T05:00:00.000Z",
        },
        "2026-09-10T08:00:00.000Z",
      ),
    ];
    const queue = writeQueue(rows);
    await withIngress(200, async (port, received) => {
      const result = await runScript(["--queue", queue, "--url", `http://${LOOPBACK}:${port}`]);
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^sent 4 rows, 3 refs/);

      expect(received).toHaveLength(1);
      const request = JSON.parse(received[0]);
      const item = request.signals[0];
      expect(item.skill).toBe("yui-daily-briefing");
      expect(item.refs).toHaveLength(3);
      expect(new Set(item.refs.map((ref: any) => ref.url)).size).toBe(3);
      expect(item.refs.map((ref: any) => ref.url)).toEqual([
        prUrl,
        "https://github.com/yw0nam/YUI/issues/876",
        "https://mail.google.com/mail/#inbox/thread-abc",
      ]);
      for (const ref of item.refs) {
        expect(ref.at).toMatch(ISO);
      }
      for (const source of item.sources) {
        expect(source.last_ok).toMatch(ISO);
      }
      expect(item.sources.map((source: any) => source.name)).toEqual(["repo-status", "gmail"]);
      expect(item.sources.map((source: any) => source.status)).toEqual(["stale", "stale"]);
      expect(request.envelope).toEqual({
        source: "cron",
        event_type: "daily_briefing",
        delivery: "immediate",
        event_id: `daily-briefing:${today()}`,
        occurred_at: expect.any(Number),
      });

      const lines = readFileSync(queue, "utf8").trim().split("\n");
      expect(lines).toHaveLength(rows.length);
      const byKey = new Map(
        lines.map((line) => {
          const row = JSON.parse(line) as Row;
          return [row.key as string, row];
        }),
      );
      for (const key of ["pr-new", "issue-new", "mail-new", "pr-old"]) {
        expect(byKey.get(key)?.status).toBe("sent");
        expect(byKey.get(key)?.sent_at).toMatch(ISO);
      }
      expect(byKey.get("pr-spoken")).toEqual(rows[4]);
    });
  });

  it("leaves rows pending when the ingress is unreachable", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, LOOPBACK, resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const queue = writeQueue([
      queueRow("pr-1", "2026-09-11T09:00:00.000Z", "pending", "repo-status", {
        source: "github_pr",
        title: "feat: a row",
        url: "https://github.com/yw0nam/YUI/pull/901",
        updated_at: "2026-09-11T09:00:00.000Z",
      }),
    ]);
    const before = readFileSync(queue, "utf8");
    const result = await runScript(["--queue", queue, "--url", `http://${LOOPBACK}:${port}`]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("yui unreachable");
    expect(readFileSync(queue, "utf8")).toBe(before);
  });

  it("leaves rows pending and exits 1 on a non-2xx answer", async () => {
    const queue = writeQueue([
      queueRow("pr-1", "2026-09-11T09:00:00.000Z", "pending", "repo-status", {
        source: "github_pr",
        title: "feat: a row",
        url: "https://github.com/yw0nam/YUI/pull/901",
        updated_at: "2026-09-11T09:00:00.000Z",
      }),
    ]);
    const before = readFileSync(queue, "utf8");
    await withIngress(400, async (port, received) => {
      const result = await runScript(["--queue", queue, "--url", `http://${LOOPBACK}:${port}`]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("400");
      expect(readFileSync(queue, "utf8")).toBe(before);
      expect(received).toHaveLength(1);
    });
  });

  it("posts the error group when a run raises", async () => {
    const queue = join(queueDir, "queue.jsonl");
    writeFileSync(queue, "not json\n");
    const before = readFileSync(queue, "utf8");
    await withIngress(200, async (port, received) => {
      const result = await runScript(["--queue", queue, "--url", `http://${LOOPBACK}:${port}`]);
      expect(result.status).toBe(1);
      expect(readFileSync(queue, "utf8")).toBe(before);
      expect(received).toHaveLength(1);
      const request = JSON.parse(received[0]);
      const item = request.signals[0];
      expect(request.envelope).toEqual({
        source: "cron",
        event_type: "source_health",
        delivery: "immediate",
        event_id: expect.stringMatching(/^source-health:daily-briefing:/),
        occurred_at: expect.any(Number),
      });
      expect(item.skill).toBe("yui-daily-briefing");
      expect(item.refs).toEqual([]);
      expect(item.sources).toEqual([{ name: "daily-briefing", status: "failed" }]);
      expect(item.summary.startsWith("daily-briefing run failed: ")).toBe(true);
      expect(item.summary.length).toBeLessThanOrEqual(200);
    });
  });
});

describe("parity with the n8n compose node", () => {
  function compose(rows: Row[]) {
    const node = readJson(TEMPLATE).nodes.find((n: any) => n.name === "Compose Daily Briefing");
    expect(node).toBeTruthy();
    const run = new Function("$input", "$now", node.parameters.jsCode);
    const now = {
      toFormat: () => "2026-09-11",
      minus: () => ({ toFormat: () => "2026-09-10 07:00" }),
    };
    const result = run({ all: () => rows.map((json) => ({ json })) }, now);
    return { output: result[0].json, request: JSON.parse(result[0].json.body) };
  }

  function row(id: number, createdAt: string, status: string, source: string, payload: unknown) {
    return { id, createdAt, status, source, key: `row-${id}`, payload: JSON.stringify(payload) };
  }

  const PR_URL = "https://github.com/yw0nam/YUI/pull/887";

  const mixedRows: Row[] = [
    row(1, "2026-09-11T09:00:00.000Z", "pending", "repo-status", {
      source: "github_pr",
      repo: "yw0nam/YUI",
      n: 887,
      title: "feat: open speech-bubble links in the default browser",
      url: PR_URL,
      updated_at: "2026-09-11T09:00:00.000Z",
    }),
    row(2, "2026-09-11T08:00:00.000Z", "pending", "repo-status", {
      source: "github_issue",
      repo: "yw0nam/YUI",
      n: 876,
      title: "Daily briefing skills",
      url: "https://github.com/yw0nam/YUI/issues/876",
      updated_at: "2026-09-11T08:00:00.000Z",
    }),
    row(3, "2026-09-11T07:00:00.000Z", "pending", "gmail", {
      source: "gmail",
      kind: "email",
      id: "m-1",
      thread_id: "thread-abc",
      subject: "Weekly build report",
      from: "someone@example.com",
      snippet: "The nightly build finished with three warnings.",
      date: "2026-09-11T07:00:00.000Z",
    }),
    row(4, "2026-09-11T05:00:00.000Z", "pending", "calendar", {
      source: "calendar",
      title: "Standup",
    }),
    row(7, "2026-09-11T05:30:00.000Z", "pending", "calendar", {
      source: "calendar",
      title: "Retro",
    }),
    row(5, "2026-09-11T05:00:00.000Z", "sent", "repo-status", {
      source: "github_pr",
      title: "chore: already spoken",
      url: "https://github.com/yw0nam/YUI/pull/870",
      updated_at: "2026-09-11T05:00:00.000Z",
    }),
    row(6, "2026-09-10T10:00:00.000Z", "pending", "repo-status", {
      source: "github_pr",
      title: "feat: open speech-bubble links in the default browser",
      url: PR_URL,
      updated_at: "2026-09-10T10:00:00.000Z",
    }),
  ];

  function longUrlBulk(): Row[] {
    const bulk: Row[] = [];
    for (let i = 0; i < 40; i += 1) {
      const suffix = String(i).padStart(4, "0");
      const url = `https://example.com/${suffix}/${"u".repeat(1975)}`;
      expect(url.length).toBe(2000);
      bulk.push(
        row(
          100 + i,
          `2026-09-11T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
          "pending",
          "bulk",
          {
            source: "other",
            title: "t".repeat(300),
            url,
            updated_at: "2026-09-11T00:00:00.000Z",
          },
        ),
      );
    }
    return bulk;
  }

  function shortUrlBulk(): Row[] {
    const bulk: Row[] = [];
    for (let i = 0; i < 40; i += 1) {
      const suffix = String(i).padStart(4, "0");
      bulk.push(
        row(
          200 + i,
          `2026-09-11T${String(i % 24).padStart(2, "0")}:00:00.000Z`,
          "pending",
          "bulk",
          {
            source: "other",
            title: `short ${suffix}`,
            url: `https://example.com/r/${suffix}`,
            updated_at: "2026-09-11T00:00:00.000Z",
          },
        ),
      );
    }
    return bulk;
  }

  async function expectParity(rows: Row[]) {
    const { request } = compose(rows);
    await withIngress(200, async (port, received) => {
      const queue = writeQueue(rows);
      const result = await runScript(["--queue", queue, "--url", `http://${LOOPBACK}:${port}`]);
      expect(result.status).toBe(0);
      expect(received).toHaveLength(1);
      const recorded = JSON.parse(received[0]);
      expect(recorded.signals[0].refs).toEqual(request.signals[0].refs);
      expect(recorded.signals[0].sources).toEqual(request.signals[0].sources);
      expect(recorded.signals[0].summary.split(" since ")[0]).toBe(
        request.signals[0].summary.split(" since ")[0],
      );
    });
  }

  it("matches the node on the mixed rows reversed", async () => {
    await expectParity([...mixedRows].reverse());
  }, 30000);

  it("matches the node on rows with 2000-character urls", async () => {
    await expectParity(longUrlBulk());
  }, 30000);

  it("matches the node on 40 short-url rows", async () => {
    await expectParity(shortUrlBulk());
  }, 30000);
});
