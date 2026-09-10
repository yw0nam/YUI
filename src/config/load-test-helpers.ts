/**
 * test-helpers.ts — shared fixtures for config/load tests.
 * known-good file bundle + in-memory ConfigReader. Mirrors the real configs/*.json shape.
 */

import type { AvatarConfig, ConfigReader, GuardrailsConfig } from "./load";

// ── fixtures (mirror the real configs/*.json) ─────────────────────────────────

/** Full avatar.json — every required tunable section present. */
export function avatarFixture(): AvatarConfig {
  return {
    vrm_url: "/vrms/carlotta.vrm",
    framing: { margin: 0.1, fov: 30 },
    hit_test: {
      hysteresis_margin_px: 8,
      poll_interval_ms: 33,
      debounce_samples: 2,
      alpha_threshold: 0.1,
    },
    gaze: {
      deadDeg: 2,
      headEngageDeg: 6,
      disengageDeg: 45,
      sensitivity: 30,
      maxHeadYaw: 50,
      maxHeadPitch: 30,
      eyeMaxDeg: 25,
      headNeckSplit: 0.6,
      smooth: 10,
    },
    tap: {
      spam_count: 4,
      spam_window_ms: 3000,
      region_radius_frac: 0.18,
      region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
      bored_cue: { label: "bored poking" },
      touch_cue_cooldown_ms: 60_000,
      touch_emotion_hold_ms: 4_000,
      pat_hold_ms: 300,
    },
    peek: {
      side_out_frac: 0.28,
      side_in_frac: 0.23,
      inset_frac: 0.12,
      mirror_side: "right",
    },
    walk: {
      interval_min_ms: 30_000,
      interval_max_ms: 60_000,
      distance_min_px: 200,
      distance_max_px: 600,
      floor_tolerance_px: 24,
    },
    perch_walk: {
      dwell_min_ms: 45_000,
      dwell_max_ms: 120_000,
      distance_min_px: 80,
      distance_max_px: 400,
      edge_margin_frac: 0.2,
      level_tolerance_px: 8,
    },
    fall: {
      gravity_px_s2: 1600,
      max_speed_px_s: 1200,
      min_drop_frac: 0.2,
      cue_cooldown_ms: 60_000,
      land_room_frac: 0.5,
      step_off_probability: 0.1,
    },
    descend: { chance: 0.5, climb_down_chance: 0.5 },
    climb: {
      interval_min_ms: 90_000,
      interval_max_ms: 180_000,
      perch_dwell_min_ms: 60_000,
      perch_dwell_max_ms: 120_000,
      max_height_frac: 4,
      hang_frac: 0.3,
      wall_offset_frac: 0.17,
      descent_wall_offset_frac: 0.3,
      ledge_walk_min_frac: 0.5,
      ledge_walk_max_frac: 1.5,
    },
    jump: {
      probability: 0.3,
      height_up_max_frac: 0.5,
      height_down_max_frac: 1,
      gap_max_width_frac: 1.5,
      apex_lift_frac: 0.15,
      takeoff_frac: 0.4,
      land_frac: 0.67,
      flight_timeout_ms: 4000,
    },
    drag_hold_ms: 5000,
    gesture_cues: {
      drag_held: { label: "dragged around" },
      window_sit: { label: "sat on window" },
      peek: { label: "peeking" },
      dropped: { label: "dropped from mid-air" },
    },
  };
}

/** Full guardrails.json — debounce, rate limit and attachment caps. */
export function guardrailsFixture(): GuardrailsConfig {
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
      tier2_max: 6,
      tier3_max: 2,
      overall_max: 20,
      cooldown_ms: 300000,
    },
    attachments: { max_count: 6, max_image_bytes: 5 * 1024 * 1024 },
  };
}

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
    "avatar.json": avatarFixture(),
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
    "guardrails.json": guardrailsFixture(),
    "filler.json": {
      gap_ms: 1000,
      gap_jitter_ms: 300,
      max_repeats: 3,
      gap_growth: 2,
      long_wait_ms: 40000,
      pools: {
        ja: {
          first: ["うーん…", "そうだね…"],
          repeat: ["ええと…", "ちょっと待ってね…"],
          long_wait: ["ちょっと時間かかってるね…"],
          tool: { _default: ["調べてみるね…"] },
          timeout: ["ごめん、諦めちゃった。"],
          unreachable: ["今つながらないみたい。"],
        },
        en: {
          first: ["Let me think...", "Hmm..."],
          repeat: ["Well...", "Just a sec..."],
          long_wait: ["This is taking a bit…"],
          tool: { _default: ["Let me check…"] },
          timeout: ["Sorry, I gave up waiting."],
          unreachable: ["I can't connect right now."],
        },
        ko: {
          first: ["음…", "그건…"],
          repeat: ["글쎄…", "잠깐만…"],
          long_wait: ["좀 오래 걸리네…"],
          tool: { _default: ["잠깐 찾아볼게…"] },
          timeout: ["미안, 포기했어."],
          unreachable: ["지금 연결이 안 돼."],
        },
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
