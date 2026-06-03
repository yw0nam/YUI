import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (rel: string): any =>
  JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf-8"));

describe("configs/endpoints.json", () => {
  const ep = read("configs/endpoints.json");

  it("carries chat/stt/tts base urls + chat endpoint", () => {
    expect(ep.chat_base_url).toMatch(/^https?:\/\//);
    expect(ep.stt_base_url).toMatch(/^https?:\/\//);
    expect(ep.tts_base_url).toMatch(/^https?:\/\//);
    expect(ep.chat_endpoint).toBe("/v1/responses"); // contract §endpoint default
  });

  it("chat/stt/tts are three distinct services", () => {
    // contract: STT/TTS는 Hermes와 무관한 별도 프로세스.
    expect(new Set([ep.chat_base_url, ep.stt_base_url, ep.tts_base_url]).size).toBe(3);
  });
});

describe("configs/emotion_tts_prefix.json", () => {
  const pre = read("configs/emotion_tts_prefix.json");

  it("is still the TBD stub — no invented prefix tokens (발명 금지)", () => {
    expect(pre._version).toBeTypeOf("string");
    expect(pre._status).toContain("TBD");
  });
});

describe("configs/motions.json", () => {
  const m = read("configs/motions.json");

  it("registers MVP motions idle/drag/sit with vrma_path + policy", () => {
    for (const id of ["idle", "drag", "sit"]) {
      expect(m[id], id).toBeDefined();
      expect(m[id].vrma_path, id).toMatch(/\.vrma$/);
      expect(m[id].priority, id).toBeTypeOf("number");
      expect(["replace", "queue", "ignore"], id).toContain(m[id].interrupt_policy);
    }
  });
});
