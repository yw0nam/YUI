import { describe, expect, it } from "vitest";
import { validateHotkeys } from "./hotkeys";
import { ConfigError } from "./shared";

const FILE = "hotkeys.json";

describe("validateHotkeys — happy path", () => {
  it("accepts an accelerator string", () => {
    const out = validateHotkeys(FILE, { summon_global: "CmdOrCtrl+Shift+Y" });
    expect(out).toEqual({ summon_global: "CmdOrCtrl+Shift+Y" });
  });

  it("treats a missing key as disabled (empty string)", () => {
    const out = validateHotkeys(FILE, {});
    expect(out).toEqual({ summon_global: "" });
  });

  it("treats an explicit empty string as disabled", () => {
    const out = validateHotkeys(FILE, { summon_global: "" });
    expect(out).toEqual({ summon_global: "" });
  });

  it("does not validate accelerator syntax (fail-soft, OS/plugin concern)", () => {
    const out = validateHotkeys(FILE, { summon_global: "not a real accelerator" });
    expect(out.summon_global).toBe("not a real accelerator");
  });
});

describe("validateHotkeys — top-level shape", () => {
  it("rejects non-object raw", () => {
    for (const raw of [[], "x", null]) {
      try {
        validateHotkeys(FILE, raw);
        expect.unreachable("validateHotkeys should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).issues).toContain("객체가 아님");
      }
    }
  });
});

describe("validateHotkeys — summon_global type", () => {
  it("rejects a non-string value", () => {
    try {
      validateHotkeys(FILE, { summon_global: 42 });
      expect.unreachable("validateHotkeys should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const err = e as ConfigError;
      expect(err.file).toBe(FILE);
      expect(err.issues.some((i) => i.includes("summon_global은 문자열이어야 함"))).toBe(true);
    }
  });
});
