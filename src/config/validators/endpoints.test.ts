import { describe, expect, it } from "vitest";
import { validateEndpoints } from "./endpoints";
import { ConfigError } from "./shared";

const FILE = "endpoints.json";

/** Minimal valid endpoints config — openai TTS provider (no irodori_* required). */
function baseRaw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chat_base_url: "http://localhost:8642",
    chat_endpoint: "/v1/responses",
    stt_base_url: "http://localhost:5517",
    tts_base_url: "http://localhost:8092",
    tts_provider: "openai",
    ...overrides,
  };
}

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateEndpoints(FILE, raw);
    expect.unreachable("validateEndpoints should have thrown");
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

describe("validateEndpoints — happy path", () => {
  it("accepts a minimal openai-provider config", () => {
    const out = validateEndpoints(FILE, baseRaw());
    expect(out).toEqual(baseRaw());
  });

  it("carries through optional string/enum fields", () => {
    const out = validateEndpoints(
      FILE,
      baseRaw({
        chat_model: "natsume",
        chat_instructions: "use generate_express",
        chat_api: "responses",
        tts_model: "tts-1",
        tts_voice: "alloy",
        tts_speed: 1.2,
        chat_model_context_window: 128000,
        tts_max_inflight: 2,
      }),
    );
    expect(out.chat_model).toBe("natsume");
    expect(out.chat_instructions).toBe("use generate_express");
    expect(out.chat_api).toBe("responses");
    expect(out.tts_model).toBe("tts-1");
    expect(out.tts_voice).toBe("alloy");
    expect(out.tts_speed).toBe(1.2);
    expect(out.chat_model_context_window).toBe(128000);
    expect(out.tts_max_inflight).toBe(2);
  });

  it("defaults tts_provider to openai, requiring no irodori fields", () => {
    const out = validateEndpoints(FILE, baseRaw({ tts_provider: undefined }));
    expect(out.tts_provider).toBe("openai");
    expect(out.irodori_base_url).toBeUndefined();
    expect(out.irodori_speaker).toBeUndefined();
  });

  it("accepts a full irodori numeric-knobs manifest", () => {
    const out = validateEndpoints(
      FILE,
      baseRaw({
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:9000",
        irodori_speaker: "natsume",
        irodori_num_steps: 10,
        irodori_cfg_scale_text: 2.5,
        irodori_cfg_scale_speaker: 1.5,
        irodori_seconds: 8,
        broker_base_url: "http://localhost:9100",
      }),
    );
    expect(out.irodori_num_steps).toBe(10);
    expect(out.irodori_cfg_scale_text).toBe(2.5);
    expect(out.irodori_cfg_scale_speaker).toBe(1.5);
    expect(out.irodori_seconds).toBe(8);
    expect(out.broker_base_url).toBe("http://localhost:9100");
  });
});

describe("validateEndpoints — unconfigured (empty) endpoints", () => {
  it("accepts a config with no keys at all — every service reads as unset", () => {
    const out = validateEndpoints(FILE, {});
    expect(out).toEqual({
      chat_base_url: "",
      chat_endpoint: "",
      stt_base_url: "",
      tts_base_url: "",
      tts_provider: "openai",
    });
  });

  it("accepts explicitly empty url strings and an empty chat_endpoint", () => {
    const out = validateEndpoints(FILE, {
      chat_base_url: "",
      chat_endpoint: "",
      stt_base_url: "",
      tts_base_url: "",
    });
    expect(out.chat_base_url).toBe("");
    expect(out.stt_base_url).toBe("");
    expect(out.tts_base_url).toBe("");
    expect(out.chat_endpoint).toBe("");
  });

  it("keeps the committed neutral defaults valid (chat_api + numeric knobs only)", () => {
    const out = validateEndpoints(FILE, {
      chat_api: "responses",
      chat_model_context_window: 200000,
      tts_max_inflight: 1,
    });
    expect(out.chat_api).toBe("responses");
    expect(out.chat_base_url).toBe("");
    expect(out.chat_endpoint).toBe("");
  });

  it("reads an empty irodori_base_url as unset rather than a malformed URL", () => {
    const out = validateEndpoints(FILE, baseRaw({ irodori_base_url: "" }));
    expect(out.irodori_base_url).toBeUndefined();
  });

  it("reads an empty broker_base_url as unset rather than a malformed URL", () => {
    const out = validateEndpoints(FILE, baseRaw({ broker_base_url: "" }));
    expect(out.broker_base_url).toBeUndefined();
  });

  it("reads an empty tts_provider as unset and resolves it to the openai default", () => {
    const out = validateEndpoints(FILE, baseRaw({ tts_provider: "" }));
    expect(out.tts_provider).toBe("openai");
  });

  it("still requires irodori_base_url when the provider is explicitly irodori", () => {
    expectIssue(
      baseRaw({ tts_provider: "irodori", irodori_base_url: "", irodori_speaker: "natsume" }),
      "irodori_base_url는 http(s) URL이어야 함",
    );
  });
});

describe("validateEndpoints — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });
});

describe("validateEndpoints — base urls", () => {
  it("rejects a chat_base_url missing http(s)", () => {
    expectIssue(
      baseRaw({ chat_base_url: "localhost:8642" }),
      "chat_base_url는 http(s) URL이어야 함",
    );
  });

  it("accepts a missing stt_base_url as unset", () => {
    expect(validateEndpoints(FILE, baseRaw({ stt_base_url: undefined })).stt_base_url).toBe("");
  });

  it("rejects a non-string tts_base_url", () => {
    expectIssue(baseRaw({ tts_base_url: 123 }), "tts_base_url는 http(s) URL이어야 함");
  });
});

describe("validateEndpoints — chat_endpoint", () => {
  it("rejects a path not starting with /", () => {
    expectIssue(baseRaw({ chat_endpoint: "v1/responses" }), "chat_endpoint는");
  });

  it("rejects a protocol-relative path (//host)", () => {
    expectIssue(baseRaw({ chat_endpoint: "//evil.example.com" }), "chat_endpoint는");
  });

  it("rejects a non-string chat_endpoint", () => {
    expectIssue(baseRaw({ chat_endpoint: 5 }), "chat_endpoint는");
  });

  it("accepts a missing chat_endpoint as unset", () => {
    expect(validateEndpoints(FILE, baseRaw({ chat_endpoint: undefined })).chat_endpoint).toBe("");
  });
});

describe("validateEndpoints — chat_model / chat_instructions / chat_api", () => {
  it("rejects an empty chat_model", () => {
    expectIssue(baseRaw({ chat_model: "  " }), "chat_model은 비어있지 않은 문자열이어야 함");
  });

  it("accepts an omitted chat_model", () => {
    const out = validateEndpoints(FILE, baseRaw());
    expect(out.chat_model).toBeUndefined();
  });

  it("rejects a non-string chat_instructions", () => {
    expectIssue(baseRaw({ chat_instructions: 42 }), "chat_instructions는 문자열이어야 함");
  });

  it("rejects an unknown chat_api", () => {
    expectIssue(baseRaw({ chat_api: "graphql" }), "chat_api는");
  });
});

describe("validateEndpoints — tts_model / tts_voice / tts_speed", () => {
  it("rejects an empty tts_model", () => {
    expectIssue(baseRaw({ tts_model: "" }), "tts_model는 비어있지 않은 문자열이어야 함");
  });

  it("rejects an empty tts_voice", () => {
    expectIssue(baseRaw({ tts_voice: "   " }), "tts_voice는 비어있지 않은 문자열이어야 함");
  });

  it("rejects tts_speed below 0.25", () => {
    expectIssue(baseRaw({ tts_speed: 0.1 }), "tts_speed는 0.25~4.0");
  });

  it("rejects tts_speed above 4.0", () => {
    expectIssue(baseRaw({ tts_speed: 4.5 }), "tts_speed는 0.25~4.0");
  });
});

describe("validateEndpoints — tts_provider", () => {
  it("rejects an unknown tts_provider", () => {
    expectIssue(baseRaw({ tts_provider: "elevenlabs" }), "tts_provider는");
  });
});

describe("validateEndpoints — irodori requireds when provider=irodori", () => {
  it("rejects missing irodori_base_url", () => {
    expectIssue(
      baseRaw({ tts_provider: "irodori", irodori_speaker: "natsume" }),
      "irodori_base_url는 http(s) URL이어야 함",
    );
  });

  it("rejects an invalid irodori_base_url", () => {
    expectIssue(
      baseRaw({
        tts_provider: "irodori",
        irodori_base_url: "not-a-url",
        irodori_speaker: "natsume",
      }),
      "irodori_base_url는 http(s) URL이어야 함",
    );
  });

  it("rejects missing irodori_speaker", () => {
    expectIssue(
      baseRaw({ tts_provider: "irodori", irodori_base_url: "http://localhost:9000" }),
      "irodori_speaker는 비어있지 않은 문자열이어야 함",
    );
  });

  it("rejects an empty irodori_speaker", () => {
    expectIssue(
      baseRaw({
        tts_provider: "irodori",
        irodori_base_url: "http://localhost:9000",
        irodori_speaker: "  ",
      }),
      "irodori_speaker는 비어있지 않은 문자열이어야 함",
    );
  });

  it("requires irodori_speaker even when only irodori_speaker is set without an explicit provider", () => {
    expectIssue(
      baseRaw({ tts_provider: undefined, irodori_speaker: "" }),
      "irodori_speaker는 비어있지 않은 문자열이어야 함",
    );
  });
});

describe("validateEndpoints — irodori numeric knobs", () => {
  const irodoriBase = {
    tts_provider: "irodori" as const,
    irodori_base_url: "http://localhost:9000",
    irodori_speaker: "natsume",
  };

  it("rejects a non-integer irodori_num_steps", () => {
    expectIssue(
      baseRaw({ ...irodoriBase, irodori_num_steps: 1.5 }),
      "irodori_num_steps는 1 이상 정수여야 함",
    );
  });

  it("rejects irodori_num_steps below 1", () => {
    expectIssue(
      baseRaw({ ...irodoriBase, irodori_num_steps: 0 }),
      "irodori_num_steps는 1 이상 정수여야 함",
    );
  });

  it("rejects a non-positive irodori_cfg_scale_text", () => {
    expectIssue(
      baseRaw({ ...irodoriBase, irodori_cfg_scale_text: 0 }),
      "irodori_cfg_scale_text는 0보다 큰 유한 number여야 함",
    );
  });

  it("rejects a non-finite irodori_cfg_scale_speaker", () => {
    expectIssue(
      baseRaw({ ...irodoriBase, irodori_cfg_scale_speaker: Number.POSITIVE_INFINITY }),
      "irodori_cfg_scale_speaker는 0보다 큰 유한 number여야 함",
    );
  });

  it("rejects a non-positive irodori_seconds", () => {
    expectIssue(baseRaw({ ...irodoriBase, irodori_seconds: -1 }), "irodori_seconds는 0보다 큰");
  });
});

describe("validateEndpoints — broker_base_url / tts_max_inflight / context window", () => {
  it("rejects an invalid broker_base_url", () => {
    expectIssue(baseRaw({ broker_base_url: "ftp://x" }), "broker_base_url는 http(s) URL이어야 함");
  });

  it("rejects a non-integer tts_max_inflight", () => {
    expectIssue(baseRaw({ tts_max_inflight: 1.5 }), "tts_max_inflight는 1 이상 정수여야 함");
  });

  it("rejects tts_max_inflight below 1", () => {
    expectIssue(baseRaw({ tts_max_inflight: 0 }), "tts_max_inflight는 1 이상 정수여야 함");
  });

  it("rejects a non-finite chat_model_context_window", () => {
    expectIssue(
      baseRaw({ chat_model_context_window: Number.NaN }),
      "chat_model_context_window는 0보다 큰",
    );
  });

  it("rejects a non-positive chat_model_context_window", () => {
    expectIssue(baseRaw({ chat_model_context_window: 0 }), "chat_model_context_window는 0보다 큰");
  });
});
