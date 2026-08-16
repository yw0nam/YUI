import { describe, expect, it } from "vitest";
import { ATTACHMENT_LIMITS_DEFAULTS } from "../load";
import { validateGuardrails } from "./guardrails";
import { ConfigError } from "./shared";

const FILE = "guardrails.json";

function baseRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    debounce_ms: {
      idle_watcher: 30000,
      os_event_watcher: 5000,
      backend_push_source: 10000,
      user_input_source: 0,
      screen_watcher: 5000,
    },
    rate_limit: {
      window_ms: 3600000,
      tier2_max: 12,
      tier3_max: 2,
      overall_max: 26,
      cooldown_ms: 300000,
    },
    attachments: {
      max_count: 6,
      max_image_bytes: 5242880,
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

  it("accepts zero debounce/rate values", () => {
    const raw = baseRaw({
      debounce_ms: {
        idle_watcher: 0,
        os_event_watcher: 0,
        backend_push_source: 0,
        user_input_source: 0,
        screen_watcher: 0,
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
          screen_watcher: 5000,
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

  it("accumulates issues for every malformed block at once (attachments defaulted)", () => {
    try {
      validateGuardrails(FILE, { debounce_ms: "y", rate_limit: "z" });
      expect.unreachable("validateGuardrails should have thrown");
    } catch (e) {
      const err = e as ConfigError;
      expect(err.issues.length).toBe(2);
    }
  });
});

describe("validateGuardrails — attachments", () => {
  it("reads the attach-time caps", () => {
    const out = validateGuardrails(
      FILE,
      baseRaw({ attachments: { max_count: 3, max_image_bytes: 1024 } }),
    );
    expect(out.attachments).toEqual({ max_count: 3, max_image_bytes: 1024 });
  });

  it("falls back to the defaults when the block is absent", () => {
    const raw = baseRaw();
    delete raw.attachments;
    expect(validateGuardrails(FILE, raw).attachments).toEqual(ATTACHMENT_LIMITS_DEFAULTS);
  });

  it("defaults the keys a partial block omits", () => {
    const out = validateGuardrails(FILE, baseRaw({ attachments: { max_count: 3 } }));
    expect(out.attachments).toEqual({
      max_count: 3,
      max_image_bytes: ATTACHMENT_LIMITS_DEFAULTS.max_image_bytes,
    });
  });

  it("still rejects a malformed key inside a partial block", () => {
    expectIssue(
      baseRaw({ attachments: { max_image_bytes: "big" } }),
      "attachments.max_image_bytes는 0 이상 유한 number여야 함",
    );
  });

  it("rejects a non-object attachments", () => {
    expectIssue(baseRaw({ attachments: "nope" }), "attachments는 객체여야 함");
  });

  it("rejects a negative field", () => {
    expectIssue(
      baseRaw({ attachments: { max_count: -1, max_image_bytes: 1024 } }),
      "attachments.max_count는 0 이상 유한 number여야 함",
    );
  });
});
