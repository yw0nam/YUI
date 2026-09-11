import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

const PLUGIN_DIR = "integrations/daily-assist";
const CLAUDE_PLUGIN = `${PLUGIN_DIR}/.claude-plugin/plugin.json`;
const PORTABLE_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

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
    expect(typeof plugin.version).toBe("string");
    expect(plugin.version).not.toBe("");
  });

  it("the portable manifest matches the Claude manifest and stays schema-locked", () => {
    const portable = readJson(`${PLUGIN_DIR}/plugin.json`);
    expect(portable.$schema).toBe(PORTABLE_SCHEMA);
    expect(portable.name).toBe("daily-assist");
    const claude = readJson(CLAUDE_PLUGIN);
    expect(portable.version).toBe(claude.version);
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
