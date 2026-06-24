import { describe, expect, it } from "vitest";

import { mergeEndpoints, setEnvVar, ttsOverrides } from "../scripts/setup.mjs";

describe("mergeEndpoints", () => {
  it("overrides only non-empty values, preserving the rest", () => {
    const existing = { chat_base_url: "http://old:1/v1", chat_model: "old", tts_voice: "keep" };
    const merged = mergeEndpoints(existing, { chat_model: "new", chat_base_url: "" });
    expect(merged.chat_model).toBe("new");
    expect(merged.chat_base_url).toBe("http://old:1/v1");
    expect(merged.tts_voice).toBe("keep");
  });

  it("treats empty string and undefined as 'keep existing'", () => {
    const existing = { a: "x", b: "y" };
    expect(mergeEndpoints(existing, { a: "", b: undefined })).toEqual({ a: "x", b: "y" });
  });

  it("does not mutate the existing object", () => {
    const existing = { a: "x" };
    mergeEndpoints(existing, { a: "z" });
    expect(existing.a).toBe("x");
  });

  it("adds keys absent from existing", () => {
    expect(mergeEndpoints({}, { broker_base_url: "http://b:1/mcp" })).toEqual({
      broker_base_url: "http://b:1/mcp",
    });
  });
});

describe("ttsOverrides", () => {
  it("irodori sets irodori_* + tts_voice + provider", () => {
    expect(ttsOverrides("irodori", { baseUrl: "http://i:1", voice: "ナツメ" })).toEqual({
      tts_provider: "irodori",
      irodori_base_url: "http://i:1",
      irodori_speaker: "ナツメ",
      tts_voice: "ナツメ",
    });
  });

  it("openai sets tts_base_url + tts_voice + provider, no irodori keys", () => {
    const o = ttsOverrides("openai", { baseUrl: "http://o:1", voice: "alloy" });
    expect(o).toEqual({ tts_provider: "openai", tts_base_url: "http://o:1", tts_voice: "alloy" });
    expect(o).not.toHaveProperty("irodori_base_url");
  });

  it("none returns no overrides", () => {
    expect(ttsOverrides("none", {})).toEqual({});
  });
});

describe("setEnvVar", () => {
  it("replaces an existing key in place, leaving other lines untouched", () => {
    const env = "# comment\nVITE_YUI_CHAT_KEY=\nYUI_LOG_TZ=KST\n";
    expect(setEnvVar(env, "VITE_YUI_CHAT_KEY", "sk-123")).toBe(
      "# comment\nVITE_YUI_CHAT_KEY=sk-123\nYUI_LOG_TZ=KST\n",
    );
  });

  it("appends a missing key", () => {
    expect(setEnvVar("YUI_LOG_TZ=KST\n", "VITE_YUI_CHAT_KEY", "sk-1")).toBe(
      "YUI_LOG_TZ=KST\nVITE_YUI_CHAT_KEY=sk-1\n",
    );
  });

  it("empty value keeps the file unchanged", () => {
    const env = "VITE_YUI_CHAT_KEY=existing\n";
    expect(setEnvVar(env, "VITE_YUI_CHAT_KEY", "")).toBe(env);
  });
});
