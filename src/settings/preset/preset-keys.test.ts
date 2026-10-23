import { describe, expect, it } from "vitest";
import { resolveStorageKey } from "./preset-keys";

describe("resolveStorageKey", () => {
  it.each([
    ["yui.message-window", "yui.ab12cd34.message-window"],
    ["yui.endpoints", "yui.ab12cd34.endpoints"],
    ["yui.chat-key", "yui.ab12cd34.chat-key"],
    ["yui.chat-id", "yui.ab12cd34.chat-id"],
    ["yui.agent", "yui.ab12cd34.agent"],
    ["yui.tts", "yui.ab12cd34.tts"],
    ["yui.tts-key", "yui.ab12cd34.tts-key"],
    ["yui.speaker", "yui.ab12cd34.speaker"],
    ["yui.chat_transcript", "yui.ab12cd34.chat_transcript"],
    ["yui.previous_response_id", "yui.ab12cd34.previous_response_id"],
    ["yui.previous_response_id.tool_outputs", "yui.ab12cd34.previous_response_id.tool_outputs"],
    ["yui.context-history", "yui.ab12cd34.context-history"],
    ["yui.session_diagnostics", "yui.ab12cd34.session_diagnostics"],
    ["yui.previous-turn", "yui.ab12cd34.previous-turn"],
    ["yui.vrm", "yui.ab12cd34.vrm"],
    ["yui.filler", "yui.ab12cd34.filler"],
    ["yui.camera", "yui.ab12cd34.camera"],
    ["yui.relations", "yui.ab12cd34.relations"],
  ])("prefixes the per-preset key %s with the active preset id", (key, expected) => {
    expect(resolveStorageKey(key, "ab12cd34")).toBe(expected);
  });

  it.each([
    "yui.vrm.user",
    "yui.speaker.user",
    "yui.stt",
    "yui.stt-key",
    "yui.vad",
    "yui.voice-mode",
    "yui.locale",
    "yui.presets",
    "yui.delegation_history",
  ])("leaves the device-wide key %s unchanged", (key) => {
    expect(resolveStorageKey(key, "ab12cd34")).toBe(key);
  });

  it("leaves every key unchanged under the default preset", () => {
    expect(resolveStorageKey("yui.endpoints", "default")).toBe("yui.endpoints");
  });
});
