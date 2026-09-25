import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

const RUNTIME_SKILL = "yui-daily-briefing";
const SKILL_DIR = `integrations/skills/${RUNTIME_SKILL}`;
const SKILL_BODY = `${SKILL_DIR}/SKILL.md`;
const FIXTURE_DIR = `${SKILL_DIR}/assets/fixtures`;
const DEFAULT_FIXTURE = `${FIXTURE_DIR}/daily-briefing.json`;
const EMPTY_FIXTURE = `${FIXTURE_DIR}/daily-briefing-empty.json`;
const SOURCES_DOWN_FIXTURE = `${FIXTURE_DIR}/daily-briefing-sources-down.json`;
const RUN_FAILED_FIXTURE = `${FIXTURE_DIR}/source-health-run-failed.json`;
const CONTRACT = `${SKILL_DIR}/references/producer-contract.md`;
const POSTER = `${SKILL_DIR}/scripts/post-briefing.py`;
const FIXTURE_SCRIPT = `${SKILL_DIR}/scripts/post-fixture.sh`;
const POST_SCRIPT = join(ROOT, FIXTURE_SCRIPT);

const STATUSES = ["ok", "stale", "failed", "disabled"];
const BODY_LIMIT = 49152;
const LOOPBACK = "127.0.0.1";

function readText(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function readJson(relativePath: string) {
  return JSON.parse(readText(relativePath));
}

function frontmatter(relativePath: string): Record<string, string> {
  const text = readText(relativePath);
  expect(text.startsWith("---\n")).toBe(true);
  const lines = text.split("\n");
  const close = lines.indexOf("---", 1);
  expect(close).toBeGreaterThan(0);
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, close)) {
    const sep = line.indexOf(": ");
    expect(sep).toBeGreaterThan(0);
    let value = line.slice(sep + 2);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    fields[line.slice(0, sep)] = value;
  }
  return fields;
}

describe("daily briefing fixtures", () => {
  for (const fixture of [
    DEFAULT_FIXTURE,
    EMPTY_FIXTURE,
    SOURCES_DOWN_FIXTURE,
    RUN_FAILED_FIXTURE,
  ]) {
    it(`${fixture} is a well-formed briefing request`, () => {
      const request = readJson(fixture);
      expect(request.signals).toHaveLength(1);
      const item = request.signals[0];
      expect(item.skill).toBe(RUNTIME_SKILL);

      expect(typeof item.summary).toBe("string");
      expect(item.summary.length).toBeLessThanOrEqual(200);

      expect(item.sources.length).toBeLessThanOrEqual(10);
      for (const source of item.sources) {
        for (const key of Object.keys(source)) {
          expect(["name", "status", "last_ok", "run_url"]).toContain(key);
        }
        expect(typeof source.name).toBe("string");
        expect(source.name.length).toBeLessThanOrEqual(40);
        expect(STATUSES).toContain(source.status);
        if ("run_url" in source) {
          expect(source.run_url).toMatch(/^https?:\/\//);
          expect(source.run_url.length).toBeLessThanOrEqual(2048);
        }
        if ("last_ok" in source) {
          expect(Number.isFinite(Date.parse(source.last_ok))).toBe(true);
        }
      }

      expect(item.refs.length).toBeLessThanOrEqual(30);
      expect(new Set(item.refs.map((r: any) => r.url)).size).toBe(item.refs.length);
      for (const ref of item.refs) {
        expect(typeof ref.kind).toBe("string");
        expect(ref.kind.length).toBeLessThanOrEqual(40);
        expect(typeof ref.title).toBe("string");
        expect(ref.title.length).toBeLessThanOrEqual(200);
        expect(ref.url).toMatch(/^https?:\/\//);
        expect(ref.url.length).toBeLessThanOrEqual(2048);
        expect(Number.isFinite(Date.parse(ref.at))).toBe(true);
        expect(typeof ref.excerpt).toBe("string");
        expect(ref.excerpt.length).toBeLessThanOrEqual(280);
      }

      const envelope = request.envelope;
      expect(Object.keys(envelope).sort()).toEqual(
        ["delivery", "event_id", "event_type", "occurred_at", "source"].sort(),
      );
      expect(envelope.delivery).toBe("immediate");
      expect(["daily_briefing", "source_health"]).toContain(envelope.event_type);
      expect(
        envelope.event_id.startsWith(
          `${envelope.event_type === "daily_briefing" ? "daily-briefing" : "source-health"}:`,
        ),
      ).toBe(true);
      expect(Number.isFinite(envelope.occurred_at)).toBe(true);
      expect(Math.abs(envelope.occurred_at)).toBeLessThanOrEqual(8.64e15);

      expect(Buffer.byteLength(JSON.stringify(request))).toBeLessThanOrEqual(BODY_LIMIT);
    });
  }

  it("the empty fixture carries no refs and healthy sources", () => {
    const item = readJson(EMPTY_FIXTURE).signals[0];
    expect(item.refs).toEqual([]);
    for (const source of item.sources) {
      expect(source.status).toBe("ok");
    }
  });

  it("the sources-down fixture carries no refs and reports failed, stale, and disabled in order", () => {
    const item = readJson(SOURCES_DOWN_FIXTURE).signals[0];
    expect(item.refs).toEqual([]);
    expect(item.sources.map((s: any) => s.status)).toEqual(["failed", "stale", "disabled"]);
    const disabled = item.sources.find((s: any) => s.status === "disabled");
    expect("last_ok" in disabled).toBe(false);
  });

  it("the run-failed fixture carries a single failed source and a source_health envelope", () => {
    const request = readJson(RUN_FAILED_FIXTURE);
    const item = request.signals[0];
    expect(item.refs).toEqual([]);
    expect(item.sources).toHaveLength(1);
    expect(item.sources[0].status).toBe("failed");
    expect(typeof item.sources[0].run_url).toBe("string");
    expect("last_ok" in item.sources[0]).toBe(false);
    expect(request.envelope.event_type).toBe("source_health");
  });
});

describe("shipped daily briefing files", () => {
  // The contract's own default listener port passes; any other loopback port is a leak.
  const PRIVATE = new RegExp(
    [
      "127\\.0\\.0\\.1:(?!8770\\b)\\d+",
      "\\b192\\.168\\.\\d+\\.\\d+",
      "\\b10\\.\\d+\\.\\d+\\.\\d+",
      "\\b172\\.(1[6-9]|2\\d|3[01])\\.\\d+\\.\\d+",
      "\\b100\\.(6[4-9]|[7-9]\\d|1[01]\\d|12[0-7])\\.\\d+\\.\\d+",
      "Bearer ",
      "api[_-]?key",
      "@gmail\\.com",
    ].join("|"),
    "i",
  );

  it("name no host, account, or secret of the instance they came from", () => {
    const shipped = [
      DEFAULT_FIXTURE,
      EMPTY_FIXTURE,
      SOURCES_DOWN_FIXTURE,
      RUN_FAILED_FIXTURE,
      CONTRACT,
      SKILL_BODY,
      POSTER,
      FIXTURE_SCRIPT,
    ];
    for (const name of shipped) {
      const text = readText(name);
      expect(`${name}: ${text.match(PRIVATE)?.[0] ?? "clean"}`).toBe(`${name}: clean`);
    }
  });
});

describe("post-fixture.sh", () => {
  type Received = { method: string; path: string; contentType: string; payload: string };

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
          method: request.method ?? "",
          path: request.url ?? "",
          contentType: String(request.headers["content-type"] ?? ""),
          payload: Buffer.concat(chunks).toString("utf8"),
        });
        response.writeHead(status).end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, LOOPBACK, resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://${LOOPBACK}:${port}`, received);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  // spawnSync would block the event loop that serves the ingress above.
  function post(base: string, fixture?: string) {
    return new Promise<{ status: number | null; stdout: string }>((resolve) => {
      const child = spawn("bash", fixture ? [POST_SCRIPT, fixture] : [POST_SCRIPT], {
        env: { ...process.env, YUI_SIGNALS_URL: base, NO_PROXY: "*", no_proxy: "*" },
      });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("close", (status) => resolve({ status, stdout }));
    });
  }

  it("posts the default fixture and reports the accepted status", async () => {
    await withIngress(200, async (base, received) => {
      const result = await post(base);
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("200");
      expect(received).toHaveLength(1);
      expect(received[0].method).toBe("POST");
      expect(received[0].path).toBe("/signals");
      expect(received[0].contentType).toBe("application/json");
      expect(JSON.parse(received[0].payload)).toEqual(readJson(DEFAULT_FIXTURE));
    });
  });

  it("reports a rejected status and fails", async () => {
    await withIngress(500, async (base, received) => {
      const result = await post(base);
      expect(result.stdout.trim()).toBe("500");
      expect(result.status).not.toBe(0);
      expect(received).toHaveLength(1);
    });
  });

  it("fails on a fixture path that resolves to nothing", async () => {
    await withIngress(200, async (base, received) => {
      const result = await post(base, join(ROOT, "tests/absent-fixture.json"));
      expect(result.status).not.toBe(0);
      expect(received).toHaveLength(0);
    });
  });
});

describe("skill bodies", () => {
  it("the skill declares its trigger and keeps its frontmatter minimal", () => {
    const fields = frontmatter(SKILL_BODY);
    expect(Object.keys(fields).sort()).toEqual(["description", "license", "name"]);
    expect(fields.name).toBe(RUNTIME_SKILL);
    expect(fields.description).toContain("signals.catchup");
    expect(fields.description.length).toBeLessThan(1024);
  });

  it("the producer contract states the day key, the size bound, and the poster", () => {
    const text = readText(CONTRACT);
    expect(text).toContain("daily-briefing:");
    expect(text).toMatch(/49,?152/);
    expect(text).toContain("source_health");
    expect(text).toContain("run_url");
    expect(text).toContain("post-briefing.py");
  });
});
