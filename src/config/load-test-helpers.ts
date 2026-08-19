/**
 * test-helpers.ts — shared fixtures for config/load tests.
 * known-good file bundle + in-memory ConfigReader. Mirrors the real configs/*.json shape.
 */

import type { ConfigReader } from "./load";

// ── fixtures (mirror the real configs/*.json) ─────────────────────────────────

/** known-good file bundle. Each test clones and lightly mutates it. */
export function goodFixture(): Record<string, unknown> {
  return {
    "endpoints.json": {
      chat_base_url: "http://localhost:8642",
      chat_endpoint: "/v1/responses",
      stt_base_url: "http://localhost:5517",
      tts_base_url: "http://localhost:8092",
      chat_instructions: "Use the generate_express tool with emotion_id, motion_id, emotion_text.",
    },
    "avatar.json": { vrm_url: "/vrms/carlotta.vrm" },
    "emotion_registry.json": {
      neutral: { vrm_expression: "neutral", fallback: "neutral" },
      happy: { vrm_expression: "happy", fallback: "neutral" },
    },
    "motions.json": {
      idle: {
        vrma_path: "assets/motions/idle.vrma",
        kind: "ambient",
        loop: true,
        priority: 0,
        interrupt_policy: "replace",
      },
      drag: {
        vrma_path: "assets/motions/drag.vrma",
        kind: "reactive",
        loop: true,
        priority: 80,
        interrupt_policy: "replace",
      },
      sit: {
        vrma_path: "assets/motions/sit.vrma",
        kind: "state",
        loop: true,
        priority: 50,
        interrupt_policy: "queue",
      },
    },
    "guardrails.json": {
      debounce_ms: {
        idle_watcher: 30000,
        os_event_watcher: 5000,
        backend_push_source: 10000,
        user_input_source: 0,
        screen_watcher: 5000,
      },
      rate_limit: {
        window_ms: 3600000,
        tier2_max: 6,
        tier3_max: 2,
        overall_max: 20,
        cooldown_ms: 300000,
      },
    },
    "filler.json": {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      pools: {
        ja: { first: ["うーん…", "そうだね…"], repeat: ["ええと…", "ちょっと待ってね…"] },
        en: { first: ["Let me think...", "Hmm..."], repeat: ["Well...", "Just a sec..."] },
        ko: { first: ["음…", "그건…"], repeat: ["글쎄…", "잠깐만…"] },
      },
    },
    "hotkeys.json": { summon_global: "CmdOrCtrl+Shift+Y" },
    "screen.json": {
      prev_dwell_ms: 600000,
      settle_ms: 90000,
      long_session_ms: 2700000,
      min_gap_ms: 300000,
      quiet_after_turn_ms: 180000,
      recent_cap: 5,
    },
  };
}

/** Reader over an in-memory map. Rejects when a file is absent (tests missing-file propagation). */
export function readerOf(map: Record<string, unknown>): ConfigReader {
  return async (file) => {
    if (!(file in map)) {
      throw new Error(`fake reader: missing ${file}`);
    }
    return map[file];
  };
}
