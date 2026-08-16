import { describe, expect, it } from "vitest";
import { validateScreen } from "./screen";
import { ConfigError } from "./shared";

const FILE = "screen.json";

const GOOD = {
  prev_dwell_ms: 600000,
  settle_ms: 90000,
  long_session_ms: 2700000,
  min_gap_ms: 300000,
  quiet_after_turn_ms: 180000,
};

const KEYS = Object.keys(GOOD) as Array<keyof typeof GOOD>;

describe("validateScreen — happy path", () => {
  it("accepts the full threshold bundle", () => {
    expect(validateScreen(FILE, { ...GOOD })).toEqual(GOOD);
  });

  it("accepts a zero min_gap_ms (bottom of the gap knob range)", () => {
    expect(validateScreen(FILE, { ...GOOD, min_gap_ms: 0 }).min_gap_ms).toBe(0);
  });

  it("drops unknown keys rather than carrying them through", () => {
    expect(validateScreen(FILE, { ...GOOD, cues: { app_switched: { label: "x" } } })).toEqual(GOOD);
  });
});

describe("validateScreen — top-level shape", () => {
  it("rejects non-object raw", () => {
    for (const raw of [[], "x", null]) {
      try {
        validateScreen(FILE, raw);
        expect.unreachable("validateScreen should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).issues).toContain("객체가 아님");
      }
    }
  });
});

describe("validateScreen — thresholds", () => {
  it("rejects a missing threshold", () => {
    for (const key of KEYS) {
      const raw: Record<string, unknown> = { ...GOOD };
      delete raw[key];
      try {
        validateScreen(FILE, raw);
        expect.unreachable(`validateScreen should have thrown for missing ${key}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ConfigError);
        expect((e as ConfigError).file).toBe(FILE);
        expect((e as ConfigError).issues.some((i) => i.startsWith(key))).toBe(true);
      }
    }
  });

  it("rejects a negative or non-finite threshold", () => {
    for (const bad of [-1, Number.NaN, "90000"]) {
      try {
        validateScreen(FILE, { ...GOOD, settle_ms: bad });
        expect.unreachable(`validateScreen should have thrown for ${String(bad)}`);
      } catch (e) {
        expect((e as ConfigError).issues.some((i) => i.startsWith("settle_ms"))).toBe(true);
      }
    }
  });
});
