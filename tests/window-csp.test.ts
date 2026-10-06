import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The `app.security.csp` value from the Tauri config. */
function readCsp(): unknown {
  const parsed = JSON.parse(readFileSync(join(ROOT, "src-tauri/tauri.conf.json"), "utf8")) as {
    app: { security: { csp: unknown } };
  };
  return parsed.app.security.csp;
}

/** Sources of each directive in a policy string, keyed by directive name. */
function directives(csp: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) map.set(name, sources);
  }
  return map;
}

describe("window Content Security Policy", () => {
  it("sets a non-empty policy string", () => {
    const csp = readCsp();
    expect(typeof csp).toBe("string");
    expect((csp as string).trim()).not.toBe("");
  });

  it("pins the directives that keep injected scripts out and the app's loads working", () => {
    const policy = directives(readCsp() as string);
    expect(policy.get("script-src")).toContain("'self'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
    expect(policy.get("connect-src")).toEqual(expect.arrayContaining(["ws:", "wss:", "blob:"]));
    expect(policy.get("img-src")).toEqual(expect.arrayContaining(["https:", "data:"]));
    expect(policy.get("object-src")).toEqual(["'none'"]);
  });
});
