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
    expect(ep.chat_model).toBe("natsume"); // Hermes 모델 ID (config-driven, PRD F8)
    expect(ep.tts_voice).toBe("ナツメ"); // /v1/audio/voices 등록 레퍼런스 보이스 default
  });

  it("carries a config-driven chat_instructions nudge mentioning generate_express + the 3 channels", () => {
    expect(ep.chat_instructions).toBeTypeOf("string");
    expect(ep.chat_instructions.length).toBeGreaterThan(0);
    expect(ep.chat_instructions).toContain("generate_express");
    expect(ep.chat_instructions).toContain("emotion_id");
    expect(ep.chat_instructions).toContain("motion_id");
    expect(ep.chat_instructions).toContain("emotion_text");
  });

  it("chat/stt/tts are three distinct services", () => {
    // contract: STT/TTS는 Hermes와 무관한 별도 프로세스.
    expect(new Set([ep.chat_base_url, ep.stt_base_url, ep.tts_base_url]).size).toBe(3);
  });

  it("stt_base_url resolves to /v1/audio/transcriptions (ASR server has the /v1 prefix)", () => {
    expect(`${ep.stt_base_url}/audio/transcriptions`).toBe(
      "http://localhost:5517/v1/audio/transcriptions",
    );
  });

  it("carries compaction knobs: context window + threshold/resume ratio + timeout", () => {
    expect(ep.chat_model_context_window).toBeGreaterThan(0);
    expect(ep.compact_threshold_ratio).toBeGreaterThan(0);
    expect(ep.compact_threshold_ratio).toBeLessThanOrEqual(1);
    expect(ep.compact_resume_ratio).toBeGreaterThan(0);
    expect(ep.compact_resume_ratio).toBeLessThanOrEqual(1);
    expect(ep.compact_timeout_ms).toBeGreaterThan(0);
  });
});

describe("configs/avatar.json", () => {
  const a = read("configs/avatar.json");

  it("points at a dev-served VRM url (#4)", () => {
    expect(a.vrm_url).toBeTypeOf("string");
    expect(a.vrm_url).toMatch(/\.vrm$/);
    expect(a.vrm_url.startsWith("/vrms/")).toBe(true); // vite dev 정적 서빙 경로
  });

  it("lists carlotta in the available[] VRM manifest (#94)", () => {
    expect(Array.isArray(a.available)).toBe(true);
    const carlotta = a.available.find((o: { id: string }) => o.id === "carlotta");
    expect(carlotta).toBeDefined();
    expect(carlotta.label).toBeTypeOf("string");
    expect(carlotta.url).toBe(a.vrm_url); // seed selection == default vrm_url
    expect(carlotta.source).toBe("bundled");
  });
});

describe("configs/guardrails.json", () => {
  const g = read("configs/guardrails.json");

  it("carries dnd / debounce_ms / rate_limit blocks with §6 defaults", () => {
    expect(g.dnd.camera_idle_off_ms).toBe(30000);
    expect(Array.isArray(g.dnd.app_blocklist)).toBe(true);
    expect(g.debounce_ms.idle_watcher).toBe(30000);
    expect(g.debounce_ms.os_event_watcher).toBe(5000);
    expect(g.debounce_ms.backend_push_source).toBe(10000);
    expect(g.debounce_ms.user_input_source).toBe(0);
    expect(g.rate_limit.window_ms).toBe(3600000);
    expect(g.rate_limit.tier2_max).toBe(12);
    expect(g.rate_limit.tier3_max).toBe(2);
    expect(g.rate_limit.overall_max).toBe(26);
    expect(g.rate_limit.cooldown_ms).toBe(300000);
  });
});

describe("configs/motions.json", () => {
  const m = read("configs/motions.json");

  it("registers all five current motions: idle/drag/happy/laugh/embarrassed", () => {
    for (const id of ["idle", "drag", "happy", "laugh", "embarrassed"]) {
      expect(m[id], id).toBeDefined();
      expect(m[id].vrma_path, `${id}.vrma_path`).toMatch(/\.vrma$/);
      expect(m[id].priority, `${id}.priority`).toBeTypeOf("number");
      expect(["replace", "queue", "ignore"], `${id}.interrupt_policy`).toContain(
        m[id].interrupt_policy,
      );
    }
  });

  it("idle is ambient kind with priority 0", () => {
    expect(m.idle.kind).toBe("ambient");
    expect(m.idle.priority).toBe(0);
    expect(m.idle.interrupt_policy).toBe("replace");
  });

  it("drag is reactive kind with priority 80", () => {
    expect(m.drag.kind).toBe("reactive");
    expect(m.drag.priority).toBe(80);
    expect(m.drag.interrupt_policy).toBe("replace");
  });

  it("happy/laugh/embarrassed are oneshot kind with priority 70 and interrupt_policy replace", () => {
    for (const id of ["happy", "laugh", "embarrassed"]) {
      expect(m[id].kind, `${id}.kind`).toBe("oneshot");
      expect(m[id].priority, `${id}.priority`).toBe(70);
      expect(m[id].interrupt_policy, `${id}.interrupt_policy`).toBe("replace");
    }
  });

  it("idle is a random-variant ambient pool (>=5 variants)", () => {
    expect(Array.isArray(m.idle.variants)).toBe(true);
    expect(m.idle.variants.length).toBeGreaterThanOrEqual(5);
    expect(m.idle.variant_policy).toBe("random");
    for (const v of m.idle.variants) {
      expect(v, "idle.variant").toMatch(/\.vrma$/);
    }
  });

  it("dance is a random-variant oneshot pool (plays a random dance per trigger)", () => {
    expect(m.dance).toBeDefined();
    expect(m.dance.kind).toBe("oneshot");
    expect(m.dance.loop).toBe(false);
    expect(m.dance.priority).toBe(70);
    expect(m.dance.variant_policy).toBe("random");
    expect(Array.isArray(m.dance.variants)).toBe(true);
    expect(m.dance.variants.length).toBeGreaterThanOrEqual(2);
    for (const v of m.dance.variants) {
      expect(v, "dance.variant").toMatch(/\.vrma$/);
    }
  });

  it("sit is a random-variant oneshot pool (plays a random sit clip per trigger)", () => {
    expect(m.sit).toBeDefined();
    expect(m.sit.kind).toBe("oneshot");
    expect(m.sit.loop).toBe(false);
    expect(m.sit.priority).toBe(70);
    expect(m.sit.variant_policy).toBe("random");
    expect(Array.isArray(m.sit.variants)).toBe(true);
    expect(m.sit.variants.length).toBeGreaterThanOrEqual(2);
    for (const v of m.sit.variants) {
      expect(v, "sit.variant").toMatch(/\.vrma$/);
    }
  });

  it("window_sit is a looping state perch with a cycle dwell and a random-variant pool", () => {
    expect(m.window_sit).toBeDefined();
    expect(m.window_sit.kind).toBe("state");
    expect(m.window_sit.loop).toBe(true);
    expect(m.window_sit.priority).toBe(55);
    expect(m.window_sit.broker_publish).toBe(false);
    expect(m.window_sit.cycle_dwell_ms).toBe(4000);
    expect(m.window_sit.variant_policy).toBe("random");
    expect(Array.isArray(m.window_sit.variants)).toBe(true);
    expect(m.window_sit.variants.length).toBe(8);
    for (const v of m.window_sit.variants) {
      expect(v, "window_sit.variant").toMatch(/\.vrma$/);
    }
  });

  it("registers the standing-gesture batch as oneshot p70", () => {
    for (const id of [
      "sheepish",
      "calm",
      "peek",
    ]) {
      expect(m[id], id).toBeDefined();
      expect(m[id].vrma_path, `${id}.vrma_path`).toMatch(/\.vrma$/);
      expect(m[id].kind, `${id}.kind`).toBe("oneshot");
      expect(m[id].loop, `${id}.loop`).toBe(false);
      expect(m[id].priority, `${id}.priority`).toBe(70);
      expect(m[id].interrupt_policy, `${id}.interrupt_policy`).toBe("replace");
    }
  });

  it("sleeping is a looping oneshot p70", () => {
    expect(m.sleeping.kind).toBe("oneshot");
    expect(m.sleeping.loop).toBe(true);
    expect(m.sleeping.priority).toBe(70);
  });

  it("dropped duplicates/mislabels are ABSENT (pose_sit_*, lean_*, hover_reaction, old ids)", () => {
    for (const id of [
      "pose_sit_1",
      "pose_sit_2",
      "pose_sit_3",
      "pose_sit_4",
      "lean_left",
      "lean_right",
      "hover_reaction",
      "shy_point",
      "pose_shy",
      "pose_salute",
      "pose_hair_touch",
      "pose_hands_folded",
    ]) {
      expect(m[id], id).toBeUndefined();
    }
  });
});
