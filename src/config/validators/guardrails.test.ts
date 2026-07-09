import { describe, expect, it } from "vitest";
import { validateGuardrails } from "./guardrails";
import { ConfigError } from "./shared";

const FILE = "guardrails.json";

function baseRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dnd: { app_blocklist: ["Zoom"], camera_idle_off_ms: 30000 },
    debounce_ms: {
      idle_watcher: 30000,
      os_event_watcher: 5000,
      backend_push_source: 10000,
      user_input_source: 0,
    },
    rate_limit: {
      window_ms: 3600000,
      tier2_max: 12,
      tier3_max: 2,
      overall_max: 26,
      cooldown_ms: 300000,
    },
    ...overrides,
  };
}

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateGuardrails(FILE, raw);
    expect.unreachable("validateGuardrails should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    const err = e as ConfigError;
    expect(err.file).toBe(FILE);
    expect(
      err.issues.some((i) => i.includes(fragment)),
      err.issues.join("; "),
    ).toBe(true);
  }
}

describe("validateGuardrails — happy path", () => {
  it("accepts a fully-populated config", () => {
    const out = validateGuardrails(FILE, baseRaw());
    expect(out).toEqual(baseRaw());
  });

  it("accepts an empty app_blocklist and zero debounce/rate values", () => {
    const raw = baseRaw({
      dnd: { app_blocklist: [], camera_idle_off_ms: 0 },
      debounce_ms: {
        idle_watcher: 0,
        os_event_watcher: 0,
        backend_push_source: 0,
        user_input_source: 0,
      },
      rate_limit: { window_ms: 0, tier2_max: 0, tier3_max: 0, overall_max: 0, cooldown_ms: 0 },
    });
    const out = validateGuardrails(FILE, raw);
    expect(out).toEqual(raw);
  });
});

describe("validateGuardrails — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });
});

describe("validateGuardrails — dnd", () => {
  it("rejects a non-object dnd", () => {
    expectIssue(baseRaw({ dnd: "nope" }), "dnd는 객체여야 함");
  });

  it("rejects app_blocklist that isn't a string array", () => {
    expectIssue(
      baseRaw({ dnd: { app_blocklist: [1, 2], camera_idle_off_ms: 0 } }),
      "dnd.app_blocklist는 string[]이어야 함",
    );
  });

  it("rejects app_blocklist that isn't an array at all", () => {
    expectIssue(
      baseRaw({ dnd: { app_blocklist: "Zoom", camera_idle_off_ms: 0 } }),
      "dnd.app_blocklist는 string[]이어야 함",
    );
  });

  it("rejects a negative camera_idle_off_ms", () => {
    expectIssue(
      baseRaw({ dnd: { app_blocklist: [], camera_idle_off_ms: -1 } }),
      "dnd.camera_idle_off_ms는 0 이상 유한 number여야 함",
    );
  });

  it("rejects a non-finite camera_idle_off_ms", () => {
    expectIssue(
      baseRaw({ dnd: { app_blocklist: [], camera_idle_off_ms: Number.POSITIVE_INFINITY } }),
      "dnd.camera_idle_off_ms는 0 이상 유한 number여야 함",
    );
  });
});

describe("validateGuardrails — debounce_ms", () => {
  it("rejects a non-object debounce_ms", () => {
    expectIssue(baseRaw({ debounce_ms: "nope" }), "debounce_ms는 객체여야 함");
  });

  it("rejects a negative field", () => {
    expectIssue(
      baseRaw({
        debounce_ms: {
          idle_watcher: -1,
          os_event_watcher: 5000,
          backend_push_source: 10000,
          user_input_source: 0,
        },
      }),
      "debounce_ms.idle_watcher는 0 이상 유한 number여야 함",
    );
  });

  it("rejects a missing field (undefined fails the number check)", () => {
    expectIssue(
      baseRaw({
        debounce_ms: { idle_watcher: 30000, os_event_watcher: 5000, backend_push_source: 10000 },
      }),
      "debounce_ms.user_input_source는 0 이상 유한 number여야 함",
    );
  });
});

describe("validateGuardrails — rate_limit", () => {
  it("rejects a non-object rate_limit", () => {
    expectIssue(baseRaw({ rate_limit: "nope" }), "rate_limit는 객체여야 함");
  });

  it("rejects a negative field", () => {
    expectIssue(
      baseRaw({
        rate_limit: {
          window_ms: 3600000,
          tier2_max: -1,
          tier3_max: 2,
          overall_max: 26,
          cooldown_ms: 300000,
        },
      }),
      "rate_limit.tier2_max는 0 이상 유한 number여야 함",
    );
  });

  it("accumulates issues for every malformed block at once", () => {
    try {
      validateGuardrails(FILE, { dnd: "x", debounce_ms: "y", rate_limit: "z" });
      expect.unreachable("validateGuardrails should have thrown");
    } catch (e) {
      const err = e as ConfigError;
      expect(err.issues.length).toBe(3);
    }
  });
});
