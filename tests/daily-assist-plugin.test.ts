import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

const PLUGIN_DIR = "integrations/daily-assist";
const CLAUDE_PLUGIN = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;
const PORTABLE_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const PLUGIN_VERSION = "0.3.0";

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8"));
}

function frontmatter(relativePath: string): Record<string, string> {
  const text = readFileSync(join(ROOT, relativePath), "utf8");
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

describe("plugin.json manifests", () => {
  it("the Claude manifest names daily-assist with a description and version", () => {
    const plugin = readJson(CLAUDE_PLUGIN);
    expect(plugin.name).toBe("daily-assist");
    expect(typeof plugin.description).toBe("string");
    expect(plugin.description).not.toBe("");
    expect(plugin.version).toBe(PLUGIN_VERSION);
  });

  it("the portable manifest matches the Claude manifest and stays schema-locked", () => {
    const portable = readJson(`${PLUGIN_DIR}/plugin.json`);
    expect(portable.$schema).toBe(PORTABLE_SCHEMA);
    expect(portable.name).toBe("daily-assist");
    const claude = readJson(CLAUDE_PLUGIN);
    expect(portable.version).toBe(claude.version);
    expect(portable.version).toBe(PLUGIN_VERSION);
    expect(portable.license).toBe(claude.license);
    expect("skills" in portable).toBe(false);
  });
});

describe(".claude-plugin/marketplace.json", () => {
  it("lists exactly the daily-assist plugin from this repository", () => {
    const marketplace = readJson(".claude-plugin/marketplace.json");
    expect(marketplace.name).toBe("yui");
    expect(typeof marketplace.owner?.name).toBe("string");
    expect(marketplace.owner.name).not.toBe("");
    expect(marketplace.plugins).toHaveLength(1);
    expect(marketplace.plugins[0].name).toBe("daily-assist");
    expect(marketplace.plugins[0].source).toBe("./integrations/daily-assist");
    expect(marketplace.plugins[0].version).toBe(readJson(CLAUDE_PLUGIN).version);
    expect(marketplace.plugins[0].version).toBe(PLUGIN_VERSION);
    const dir = resolve(ROOT, marketplace.plugins[0].source);
    expect(existsSync(join(dir, ".claude-plugin/plugin.json"))).toBe(true);
    expect(existsSync(join(dir, "plugin.json"))).toBe(true);
  });
});

describe(".agents/plugins/marketplace.json", () => {
  it("lists exactly the daily-assist plugin as a local, available entry", () => {
    const marketplace = readJson(".agents/plugins/marketplace.json");
    expect(marketplace.name).toBe("yui");
    expect(typeof marketplace.interface?.displayName).toBe("string");
    expect(marketplace.interface.displayName).not.toBe("");
    expect(marketplace.plugins).toHaveLength(1);
    const entry = marketplace.plugins[0];
    expect(entry.name).toBe("daily-assist");
    expect(entry.source.source).toBe("local");
    expect(entry.source.path).toBe("./integrations/daily-assist");
    expect(entry.policy.installation).toBe("AVAILABLE");
    expect(entry.policy.authentication).toBe("ON_INSTALL");
    expect(typeof entry.category).toBe("string");
    expect(entry.category).not.toBe("");
    expect("version" in entry).toBe(false);
    const dir = resolve(ROOT, entry.source.path);
    expect(existsSync(join(dir, ".claude-plugin/plugin.json"))).toBe(true);
    expect(existsSync(join(dir, "plugin.json"))).toBe(true);
  });
});

describe("skills", () => {
  const skillNames = readdirSync(join(ROOT, PLUGIN_DIR, "skills"));

  it("ships at least two skills", () => {
    expect(skillNames.length).toBeGreaterThanOrEqual(2);
  });

  for (const skill of skillNames) {
    it(`${skill} carries frontmatter that names and describes it`, () => {
      const fields = frontmatter(`${PLUGIN_DIR}/skills/${skill}/SKILL.md`);
      expect(fields.name).toBe(skill);
      expect(fields.description).toBeTruthy();
      expect(fields.license).toBeTruthy();
      expect(Object.keys(fields)).not.toContain("metadata");
    });
  }
});

const RUNTIME_SKILL = "yui-daily-briefing";
const SETUP_SKILL = "yui-daily-briefing-setup";
const SETUP_DIR = `${PLUGIN_DIR}/skills/${SETUP_SKILL}`;
const FIXTURE_DIR = `${SETUP_DIR}/assets/fixtures`;
const DEFAULT_FIXTURE = `${FIXTURE_DIR}/daily-briefing.json`;
const EMPTY_FIXTURE = `${FIXTURE_DIR}/daily-briefing-empty.json`;
const SOURCES_DOWN_FIXTURE = `${FIXTURE_DIR}/daily-briefing-sources-down.json`;
const RUN_FAILED_FIXTURE = `${FIXTURE_DIR}/source-health-run-failed.json`;
const TEMPLATE = `${SETUP_DIR}/references/n8n-daily-briefing.template.json`;
const HEALTH_TEMPLATE = `${SETUP_DIR}/references/n8n-daily-briefing-health.template.json`;
const CONTRACT = `${SETUP_DIR}/references/producer-contract.md`;
const POST_SCRIPT = join(ROOT, SETUP_DIR, "scripts/post-fixture.sh");

const KINDS = ["pull_request", "issue", "mail", "other"];
const STATUSES = ["ok", "stale", "failed", "disabled"];
const BODY_LIMIT = 49152;
const LOOPBACK = "127.0.0.1";

function readText(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
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
        expect(KINDS).toContain(ref.kind);
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

describe("n8n template", () => {
  const template = () => readJson(TEMPLATE);

  function nodesOfType(type: string) {
    return template().nodes.filter((node: any) => node.type === type);
  }

  function targetsOf(connections: any, node: string, outputIndex: number): string[] {
    return (connections[node]?.main?.[outputIndex] ?? []).map((link: any) => link.node);
  }

  function reachable(connections: any, seeds: string[], barrier?: string): Set<string> {
    const seen = new Set<string>();
    const queue = [...seeds];
    while (queue.length) {
      const node = queue.shift() as string;
      if (node === barrier) continue;
      for (const branch of connections[node]?.main ?? []) {
        for (const link of branch ?? []) {
          if (seen.has(link.node)) continue;
          seen.add(link.node);
          queue.push(link.node);
        }
      }
    }
    return seen;
  }

  it("wires one schedule trigger with an hour of day", () => {
    const triggers = nodesOfType("n8n-nodes-base.scheduleTrigger");
    expect(triggers).toHaveLength(1);
    expect(typeof triggers[0].parameters.rule.interval[0].triggerAtHour).toBe("number");
  });

  it("posts the composed body to the ingress placeholder", () => {
    const requests = nodesOfType("n8n-nodes-base.httpRequest");
    expect(requests).toHaveLength(1);
    const parameters = requests[0].parameters;
    expect(parameters.method).toBe("POST");
    expect(parameters.url).toBe("{{YUI_SIGNALS_URL}}/signals");
    expect(parameters.jsonBody).toBe("={{ $json.body }}");
    expect(parameters.options.response.response.fullResponse).toBe(true);
    expect(parameters.options.response.response.neverError).toBe(true);
  });

  it("reads and writes the signal queue through the table placeholder", () => {
    const tables = nodesOfType("n8n-nodes-base.dataTable");
    expect(tables.length).toBeGreaterThanOrEqual(1);
    for (const table of tables) {
      expect(table.parameters.dataTableId.value).toBe("{{SIGNAL_QUEUE_TABLE_ID}}");
    }
  });

  it("marks rows sent only on the true branch of the status check", () => {
    const parsed = template();
    const updates = parsed.nodes.filter(
      (node: any) =>
        node.type === "n8n-nodes-base.dataTable" &&
        node.parameters.operation === "update" &&
        node.parameters.columns?.value?.status === "sent",
    );
    expect(updates).toHaveLength(1);
    const markSent = updates[0].name;

    const ifNodes = parsed.nodes.filter((node: any) => node.type === "n8n-nodes-base.if");
    expect(ifNodes).toHaveLength(1);
    const gate = ifNodes[0].name;

    const connections = parsed.connections;
    const onTrue = reachable(connections, targetsOf(connections, gate, 0));
    const onFalse = reachable(connections, targetsOf(connections, gate, 1));
    expect([...onTrue, ...targetsOf(connections, gate, 0)]).toContain(markSent);
    expect([...onFalse, ...targetsOf(connections, gate, 1)]).not.toContain(markSent);

    const triggers = parsed.nodes.filter(
      (node: any) => node.type === "n8n-nodes-base.scheduleTrigger",
    );
    const beforeGate = reachable(connections, [triggers[0].name], gate);
    expect([...beforeGate]).not.toContain(markSent);
  });

  it("carries neither credentials nor instance ids", () => {
    for (const node of template().nodes) {
      expect(Object.keys(node)).not.toContain("credentials");
      expect(Object.keys(node)).not.toContain("id");
    }
  });
});

describe("shipped daily briefing files", () => {
  const PRIVATE = new RegExp(
    [
      "127\\.0\\.0\\.1:\\d+",
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
    const shipped: Array<[string, string]> = [
      [TEMPLATE, JSON.stringify(readJson(TEMPLATE))],
      [HEALTH_TEMPLATE, JSON.stringify(readJson(HEALTH_TEMPLATE))],
      [DEFAULT_FIXTURE, JSON.stringify(readJson(DEFAULT_FIXTURE))],
      [EMPTY_FIXTURE, JSON.stringify(readJson(EMPTY_FIXTURE))],
      [SOURCES_DOWN_FIXTURE, JSON.stringify(readJson(SOURCES_DOWN_FIXTURE))],
      [RUN_FAILED_FIXTURE, JSON.stringify(readJson(RUN_FAILED_FIXTURE))],
      [CONTRACT, readText(CONTRACT)],
    ];
    for (const [name, text] of shipped) {
      expect(`${name}: ${text.match(PRIVATE)?.[0] ?? "clean"}`).toBe(`${name}: clean`);
    }
  });
});

describe("n8n template compose code", () => {
  type Row = Record<string, unknown>;

  function compose(rows: Row[]) {
    const template = readJson(TEMPLATE);
    const node = template.nodes.find((n: any) => n.name === "Compose Daily Briefing");
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
    row(4, "2026-09-11T06:00:00.000Z", "pending", "calendar", {
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

  // Reversed so the newest-first output can only come from the code's own sort.
  const shuffledRows: Row[] = [...mixedRows].reverse();

  it("maps pending rows to one ref per distinct url, newest first", () => {
    const { request } = compose(shuffledRows);
    const refs = request.signals[0].refs;
    expect(refs.map((r: any) => r.kind)).toEqual(["pull_request", "issue", "mail"]);
    expect(refs[0].url).toBe(PR_URL);
    expect(refs[2].url).toBe("https://mail.google.com/mail/#inbox/thread-abc");
    expect(refs.map((r: any) => r.url)).not.toContain("https://github.com/yw0nam/YUI/pull/870");
    expect(refs).toHaveLength(3);
  });

  it("counts every pending row in the summary and queues them all for marking", () => {
    const { output, request } = compose(shuffledRows);
    expect(request.signals[0].summary).toBe(
      "1 pull request, 1 issue, 1 mail, 2 others since 2026-09-10 10:00",
    );
    expect(output.posted_ids).toEqual([1, 2, 3, 4, 7, 6]);
  });

  it("keeps the request inside the caps when rows overflow it", () => {
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
    const { output, request } = compose(bulk);
    const refs = request.signals[0].refs;
    expect(refs.length).toBeLessThanOrEqual(30);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.title.length).toBeLessThanOrEqual(200);
    }
    expect(Buffer.byteLength(output.body)).toBeLessThanOrEqual(BODY_LIMIT);
  });

  it("stops at thirty refs when the rows fit inside the size cap", () => {
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
    const { output, request } = compose(bulk);
    expect(request.signals[0].refs).toHaveLength(30);
    expect(Buffer.byteLength(output.body)).toBeLessThanOrEqual(BODY_LIMIT);
    expect(output.posted_ids).toHaveLength(40);
  });

  it("times a ref whose payload and row timestamps are both unparseable", () => {
    const { request } = compose([
      row(300, "not-a-date", "pending", "repo-status", {
        source: "github_pr",
        title: "fix: a row with broken timestamps",
        url: "https://github.com/yw0nam/YUI/pull/901",
        updated_at: "garbage",
      }),
    ]);
    const refs = request.signals[0].refs;
    expect(refs).toHaveLength(1);
    expect(Number.isFinite(Date.parse(refs[0].at))).toBe(true);
  });

  it("reads source health from the newest row of each source", () => {
    const hourMs = 3600000;
    const fresh = new Date(Date.now() - hourMs).toISOString();
    const old = new Date(Date.now() - 100 * hourMs).toISOString();
    const { request } = compose([
      row(400, fresh, "pending", "repo-status", {
        source: "github_pr",
        title: "feat: a fresh row",
        url: "https://github.com/yw0nam/YUI/pull/902",
        updated_at: fresh,
      }),
      row(401, old, "sent", "gmail", {
        source: "gmail",
        thread_id: "thread-old",
        subject: "An old mail",
        date: old,
      }),
    ]);
    const sources = request.signals[0].sources;
    expect(sources.find((s: any) => s.name === "repo-status")).toEqual({
      name: "repo-status",
      status: "ok",
      last_ok: fresh,
    });
    expect(sources.find((s: any) => s.name === "gmail")).toEqual({
      name: "gmail",
      status: "stale",
      last_ok: old,
    });
  });

  it("posts an empty briefing with stale sources when nothing is pending", () => {
    const { request } = compose([]);
    const item = request.signals[0];
    expect(item.refs).toEqual([]);
    expect(item.summary.startsWith("nothing new since")).toBe(true);
    expect(item.sources.length).toBeGreaterThan(0);
    for (const source of item.sources) {
      expect(source.status).toBe("stale");
      expect("last_ok" in source).toBe(false);
    }
  });

  it("stamps the envelope with the day key and immediate delivery", () => {
    const { request } = compose(shuffledRows);
    expect(request.envelope.event_id).toBe("daily-briefing:2026-09-11");
    expect(request.envelope.event_type).toBe("daily_briefing");
    expect(request.envelope.delivery).toBe("immediate");
    expect(Number.isFinite(request.envelope.occurred_at)).toBe(true);
  });
});

describe("n8n health template", () => {
  const template = () => readJson(HEALTH_TEMPLATE);

  function nodesOfType(type: string) {
    return template().nodes.filter((node: any) => node.type === type);
  }

  it("wires exactly one error trigger", () => {
    const triggers = nodesOfType("n8n-nodes-base.errorTrigger");
    expect(triggers).toHaveLength(1);
  });

  it("posts the composed body to the ingress placeholder", () => {
    const requests = nodesOfType("n8n-nodes-base.httpRequest");
    expect(requests).toHaveLength(1);
    const parameters = requests[0].parameters;
    expect(parameters.method).toBe("POST");
    expect(parameters.url).toBe("{{YUI_SIGNALS_URL}}/signals");
    expect(parameters.jsonBody).toBe("={{ $json.body }}");
    expect(parameters.options.response.response.fullResponse).toBe(true);
    expect(parameters.options.response.response.neverError).toBe(true);
  });

  it("carries neither credentials nor instance ids", () => {
    for (const node of template().nodes) {
      expect(Object.keys(node)).not.toContain("credentials");
      expect(Object.keys(node)).not.toContain("id");
    }
  });

  it("has no data table nodes", () => {
    expect(nodesOfType("n8n-nodes-base.dataTable")).toHaveLength(0);
  });

  it("chains the error trigger through the code node to the http request", () => {
    const parsed = template();
    const trigger = parsed.nodes.find((n: any) => n.type === "n8n-nodes-base.errorTrigger").name;
    const code = parsed.nodes.find((n: any) => n.type === "n8n-nodes-base.code").name;
    const request = parsed.nodes.find((n: any) => n.type === "n8n-nodes-base.httpRequest").name;
    expect(parsed.connections[trigger].main[0].map((l: any) => l.node)).toEqual([code]);
    expect(parsed.connections[code].main[0].map((l: any) => l.node)).toEqual([request]);
  });
});

describe("n8n health template compose code", () => {
  function compose(item: Record<string, unknown>) {
    const template = readJson(HEALTH_TEMPLATE);
    const node = template.nodes.find((n: any) => n.name === "Compose Health Signal");
    expect(node).toBeTruthy();
    const run = new Function("$input", node.parameters.jsCode);
    const result = run({ first: () => ({ json: item }) });
    return { output: result[0].json, request: JSON.parse(result[0].json.body) };
  }

  const documentedItem = {
    execution: {
      id: "231",
      url: "https://n8n.example.com/execution/231",
      retryOf: null,
      error: { message: "connect ECONNREFUSED", stack: "" },
      lastNodeExecuted: "Fetch Signal Queue Rows",
      mode: "trigger",
    },
    workflow: { id: "1", name: "daily-briefing" },
  };

  it("composes a source_health group from a failed execution", () => {
    const { output, request } = compose(documentedItem);
    const item = request.signals[0];
    expect(item.skill).toBe(RUNTIME_SKILL);
    expect(item.sources[0]).toEqual({
      name: "daily-briefing",
      status: "failed",
      run_url: "https://n8n.example.com/execution/231",
    });
    expect(item.refs).toEqual([]);
    expect(item.summary).toContain("Fetch Signal Queue Rows");
    expect(item.summary).toContain("connect ECONNREFUSED");
    expect(item.summary.length).toBeLessThanOrEqual(200);
    expect(request.envelope.event_type).toBe("source_health");
    expect(request.envelope.event_id).toBe("source-health:1:231");
    expect(request.envelope.delivery).toBe("immediate");
    expect(Number.isFinite(request.envelope.occurred_at)).toBe(true);
    expect(Buffer.byteLength(output.body)).toBeLessThanOrEqual(BODY_LIMIT);
  });

  it("clips a long workflow name, omits a missing run_url, and survives a missing error", () => {
    const longName = "w".repeat(60);
    const { request } = compose({
      execution: { id: "9", lastNodeExecuted: "" },
      workflow: { id: "9", name: longName },
    });
    const source = request.signals[0].sources[0];
    expect(source.name.length).toBe(40);
    expect("run_url" in source).toBe(false);
    expect(request.envelope.event_id).toBe("source-health:9:9");
  });

  it("omits run_url for a non-http execution url", () => {
    for (const url of ["javascript:alert(1)", "/execution/2"]) {
      const { request } = compose({
        execution: { id: "1", url },
        workflow: { id: "1", name: "daily-briefing" },
      });
      expect("run_url" in request.signals[0].sources[0]).toBe(false);
    }
  });

  it("clips a long error message to exactly 200 characters ending in an ellipsis", () => {
    const { request } = compose({
      execution: { id: "1", error: { message: "e".repeat(300) } },
      workflow: { id: "1", name: "daily-briefing" },
    });
    const summary = request.signals[0].summary;
    expect(summary.length).toBe(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("composes from a trigger-time failure that carries no execution record", () => {
    const { request } = compose({
      trigger: {
        error: {
          name: "WorkflowActivationError",
          message: "",
          cause: { message: "listen EADDRINUSE" },
        },
        mode: "trigger",
      },
      workflow: { id: "1", name: "daily-briefing" },
    });
    const item = request.signals[0];
    expect(item.summary).toContain("WorkflowActivationError");
    expect(item.summary).toContain("listen EADDRINUSE");
    expect("run_url" in item.sources[0]).toBe(false);
    expect(request.envelope.event_id).toMatch(/^source-health:1:\d+$/);
  });

  it("falls back to a workflow name and a timestamp-based execution id on an empty item", () => {
    const { request } = compose({});
    expect(request.signals[0].sources[0].name).toBe("workflow");
    expect(request.envelope.event_id).toMatch(/^source-health:unknown:\d+$/);
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
  it("the runtime skill declares its trigger and keeps its frontmatter minimal", () => {
    const fields = frontmatter(`${PLUGIN_DIR}/skills/${RUNTIME_SKILL}/SKILL.md`);
    expect(Object.keys(fields).sort()).toEqual(["description", "license", "name"]);
    expect(fields.description).toContain(RUNTIME_SKILL);
    expect(fields.description).toContain("signals.catchup");
    expect(fields.description.length).toBeLessThan(1024);
  });

  it("the runtime body covers continuation, links, and every ref kind", () => {
    const text = readText(`${PLUGIN_DIR}/skills/${RUNTIME_SKILL}/SKILL.md`);
    expect(text).toContain("previous:");
    expect(text).toContain("[title](url)");
    expect(text).toContain("run_url");
    for (const kind of KINDS) {
      expect(text).toContain(kind);
    }
  });

  it("the setup skill keeps its frontmatter minimal", () => {
    const fields = frontmatter(`${SETUP_DIR}/SKILL.md`);
    expect(Object.keys(fields).sort()).toEqual(["description", "license", "name"]);
    expect(fields.description.length).toBeLessThan(1024);
  });

  it("the setup body names the settings, the script, and both placeholders", () => {
    const text = readText(`${SETUP_DIR}/SKILL.md`);
    for (const marker of [
      "Agent notifications",
      "Scheduled greeting",
      "post-fixture.sh",
      "{{YUI_SIGNALS_URL}}",
      "{{SIGNAL_QUEUE_TABLE_ID}}",
      "SOURCES",
      "n8n-daily-briefing-health.template.json",
      "source-health-run-failed.json",
    ]) {
      expect(text).toContain(marker);
    }
  });

  it("the producer contract states the day key, the size bound, and every ref kind", () => {
    const text = readText(CONTRACT);
    expect(text).toContain("daily-briefing:");
    expect(text).toMatch(/49,?152/);
    expect(text).toContain("source_health");
    expect(text).toContain("run_url");
    for (const kind of KINDS) {
      expect(text).toContain(kind);
    }
  });
});
