import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../src/ui/i18n/en";

const ROOT = resolve(__dirname, "..");
const SKILL_DIR = "integrations/skills/yui-daily-briefing";
const SKILL_BODY = `${SKILL_DIR}/SKILL.md`;
const CONTRACT = `${SKILL_DIR}/references/producer-contract.md`;
const SCRIPT = `${SKILL_DIR}/scripts/briefing.py`;
const GATHER = `${SKILL_DIR}/assets/fixtures/gather.json`;

function readText(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

function frontmatter(relativePath: string): Record<string, string> {
  const lines = readText(relativePath).split("\n");
  expect(lines[0]).toBe("---");
  const close = lines.indexOf("---", 1);
  expect(close).toBeGreaterThan(0);
  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, close)) {
    const sep = line.indexOf(": ");
    expect(sep).toBeGreaterThan(0);
    fields[line.slice(0, sep)] = line.slice(sep + 2).replace(/^"(.*)"$/, "$1");
  }
  return fields;
}

describe("yui-daily-briefing skill files", () => {
  it("the gather fixture stays inside the input caps", () => {
    const input = JSON.parse(readText(GATHER));
    expect(input.summary.length).toBeLessThanOrEqual(200);
    for (const source of input.sources) {
      expect(source.name.length).toBeLessThanOrEqual(40);
      expect(["ok", "stale", "failed", "disabled"]).toContain(source.status);
    }
    for (const ref of input.refs) {
      expect(ref.url).toMatch(/^https?:\/\//);
      expect(ref.title.length).toBeLessThanOrEqual(200);
      expect(ref.excerpt.length).toBeLessThanOrEqual(280);
    }
  });

  it("name no host, account, or secret of the instance they came from", () => {
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
    for (const name of [SKILL_BODY, CONTRACT, SCRIPT, GATHER]) {
      const text = readText(name);
      expect(`${name}: ${text.match(PRIVATE)?.[0] ?? "clean"}`).toBe(`${name}: clean`);
    }
  });

  it("the skill triggers on the first-activity milestone and keeps its frontmatter minimal", () => {
    const fields = frontmatter(SKILL_BODY);
    expect(Object.keys(fields).sort()).toEqual(["description", "license", "name"]);
    expect(fields.name).toBe("yui-daily-briefing");
    expect(fields.description).toContain("first_activity");
    expect(fields.description.length).toBeLessThan(1024);
  });

  it("the install section names the client setting and schedules producers into one spool", () => {
    const text = readText(SKILL_BODY);
    expect(text).toContain(`"${en["cue.schedule_title"]}"`);
    expect(text).toContain("YUI_BRIEFING_SPOOL=");
    expect(text).toContain('| python3 "$SKILL_DIR/scripts/briefing.py" write --source ');
    expect(text).toContain('python3 "$SKILL_DIR/scripts/briefing.py" pending');
    expect(text).toContain('python3 "$SKILL_DIR/scripts/briefing.py" mark-spoken');
  });

  it("the producer contract states the file format, the ledger, and the subcommands", () => {
    const text = readText(CONTRACT);
    for (const term of [
      "YUI_BRIEFING_SPOOL",
      "spoken.json",
      "write",
      "pending",
      "mark-spoken",
      "run_url",
    ]) {
      expect(text).toContain(term);
    }
  });
});
