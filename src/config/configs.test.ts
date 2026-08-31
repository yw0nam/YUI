import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { agentTriggerableMotionIds } from "../io/broker-client";
import { validateEndpoints } from "./validators/endpoints";
import { validateMotions } from "./validators/motions";
import { validateScreen } from "./validators/screen";

const read = (rel: string): any => JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf-8"));

describe("configs/endpoints.json", () => {
  const ep = read("configs/endpoints.json");

  it("ships no service address — every URL is unconfigured until the user sets one", () => {
    for (const key of ["chat_base_url", "stt_base_url", "tts_base_url", "broker_base_url"]) {
      expect(ep, key).not.toHaveProperty(key);
    }
  });

  it("ships no personal model or voice selection", () => {
    for (const key of ["chat_model", "tts_speaker"]) {
      expect(ep, key).not.toHaveProperty(key);
    }
  });

  it("carries the TTS model name the server is configured under", () => {
    expect(ep.tts_model).toBe("irodori-tts");
  });

  it("carries the chat protocol selection", () => {
    expect(ep.chat_api).toBe("chat_completions");
  });

  it("carries a config-driven chat_instructions nudge mentioning generate_express + the 3 channels", () => {
    expect(ep.chat_instructions).toBeTypeOf("string");
    expect(ep.chat_instructions.length).toBeGreaterThan(0);
    expect(ep.chat_instructions).toContain("generate_express");
    expect(ep.chat_instructions).toContain("emotion_id");
    expect(ep.chat_instructions).toContain("motion_id");
    expect(ep.chat_instructions).toContain("emotion_text");
  });

  it("passes the real endpoints config through validation", () => {
    expect(() => validateEndpoints("configs/endpoints.json", ep)).not.toThrow();
  });

  it("carries the chat model context window for token-usage tracking", () => {
    expect(ep.chat_model_context_window).toBeGreaterThan(0);
  });
});

describe("configs/avatar.json", () => {
  const a = read("configs/avatar.json");

  it("points at a dev-served VRM url", () => {
    expect(a.vrm_url).toBeTypeOf("string");
    expect(a.vrm_url).toMatch(/\.vrm$/);
    expect(a.vrm_url.startsWith("/vrms/")).toBe(true); // vite dev static-serving path
  });

  it("lists sendagaya_shino in the available[] VRM manifest", () => {
    expect(Array.isArray(a.available)).toBe(true);
    const shino = a.available.find((o: { id: string }) => o.id === "sendagaya_shino");
    expect(shino).toBeDefined();
    expect(shino.label).toBeTypeOf("string");
    expect(shino.url).toBe(a.vrm_url); // seed selection == default vrm_url
    expect(shino.source).toBe("bundled");
  });

  it("maps the head region to the press-and-hold pat reaction", () => {
    expect(a.tap.region_motions.head).toBe("head_pat");
    expect(a.tap.region_emotions.head).toBe("relaxed");
    expect(a.tap.pat_hold_ms).toBe(300);
  });

  it("carries side-peek geometry and mirroring defaults", () => {
    expect(a.peek).toEqual({
      side_out_frac: 0.28,
      side_in_frac: 0.23,
      inset_frac: 0.12,
      mirror_side: "right",
    });
  });

  it("carries the ambient walk scheduler knobs", () => {
    expect(a.walk).toEqual({
      interval_min_ms: 30000,
      interval_max_ms: 60000,
      distance_min_px: 200,
      distance_max_px: 600,
      floor_tolerance_px: 24,
    });
  });

  it("carries the drag-release fall dynamics", () => {
    expect(a.fall).toEqual({
      gravity_px_s2: 1600,
      max_speed_px_s: 1200,
      min_drop_frac: 0.2,
      cue_cooldown_ms: 60000,
    });
  });

  it("carries the ambient window-climb knobs", () => {
    expect(a.climb).toEqual({
      interval_min_ms: 90000,
      interval_max_ms: 180000,
      perch_dwell_min_ms: 60000,
      perch_dwell_max_ms: 120000,
      max_height_frac: 4,
      hang_frac: 0.3,
      wall_offset_frac: 0.3,
      ledge_walk_min_frac: 0.5,
      ledge_walk_max_frac: 1.5,
    });
  });

  it("carries the ambient window-jump knobs", () => {
    expect(a.jump).toEqual({
      probability: 0.3,
      height_up_max_frac: 0.5,
      height_down_max_frac: 1,
      gap_max_width_frac: 1.5,
      apex_lift_frac: 0.15,
      takeoff_frac: 0.4,
      land_frac: 0.67,
    });
  });

  it("ships built-in touch/gesture cues as label-only (context is persona judgment, not client data)", () => {
    const builtIn: Array<[string, any]> = [
      ["tap.region_cues.head", a.tap.region_cues.head],
      ["tap.region_cues.chest", a.tap.region_cues.chest],
      ["tap.region_cues.hips", a.tap.region_cues.hips],
      ["tap.bored_cue", a.tap.bored_cue],
      ["gesture_cues.drag_held", a.gesture_cues.drag_held],
      ["gesture_cues.window_sit", a.gesture_cues.window_sit],
      ["gesture_cues.peek", a.gesture_cues.peek],
      ["gesture_cues.dropped", a.gesture_cues.dropped],
    ];
    for (const [path, cue] of builtIn) {
      expect(cue, path).toBeDefined();
      expect(cue.label, `${path}.label`).toBeTypeOf("string");
      expect(Object.keys(cue), path).toEqual(["label"]);
    }
  });
});

describe("configs/guardrails.json", () => {
  const g = read("configs/guardrails.json");

  it("carries debounce_ms / rate_limit blocks with §6 defaults", () => {
    expect(g.debounce_ms.idle_watcher).toBe(30000);
    expect(g.debounce_ms.os_event_watcher).toBe(5000);
    expect(g.debounce_ms.backend_push_source).toBe(10000);
    expect(g.debounce_ms.user_input_source).toBe(0);
    expect(g.debounce_ms.screen_watcher).toBe(5000);
    expect(g.rate_limit.window_ms).toBe(3600000);
    expect(g.rate_limit.tier2_max).toBe(24);
    expect(g.rate_limit.tier3_max).toBe(2);
    expect(g.rate_limit.overall_max).toBe(40);
    expect(g.rate_limit.cooldown_ms).toBe(300000);
  });

  it("carries the attach-time caps for turn attachments", () => {
    expect(g.attachments.max_count).toBe(6);
    expect(g.attachments.max_image_bytes).toBe(5242880);
  });
});

describe("configs/screen.json", () => {
  const s = read("configs/screen.json");

  it("carries the frontmost-transition thresholds", () => {
    expect(s.prev_dwell_ms).toBe(600000);
    expect(s.settle_ms).toBe(90000);
    expect(s.long_session_ms).toBe(2700000);
    expect(s.min_gap_ms).toBe(300000);
    expect(s.quiet_after_turn_ms).toBe(180000);
    expect(s.recent_cap).toBe(5);
  });

  it("passes the real screen config through validation", () => {
    expect(() => validateScreen("configs/screen.json", s)).not.toThrow();
  });
});

describe("configs/hotkeys.json", () => {
  const h = read("configs/hotkeys.json");

  it("carries the global summon accelerator default", () => {
    expect(h.summon_global).toBe("CmdOrCtrl+Shift+Y");
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

  it("idle keeps its renderer-critical ambient baseline shape", () => {
    expect(m.idle).toBeDefined();
    expect(m.idle.kind).toBe("ambient");
    expect(m.idle.loop).toBe(true);
    expect(m.idle.vrma_path).toBe("/motions/calm.vrma");
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

  it("idle is the exact calm random-variant ambient pool", () => {
    expect(m.idle.variants).toEqual([
      "/motions/calm.vrma",
      "/motions/idle_01.vrma",
      "/motions/idle_04.vrma",
      "/motions/idle_12.vrma",
    ]);
    expect(m.idle.variant_policy).toBe("random");
  });

  it("idle_lively is the exact broker-published lively oneshot pool", () => {
    expect(m.idle_lively.variants).toEqual([
      "/motions/idle_02.vrma",
      "/motions/idle_03.vrma",
      "/motions/idle_05.vrma",
      "/motions/idle_06.vrma",
      "/motions/idle_07.vrma",
      "/motions/idle_08.vrma",
      "/motions/idle_09.vrma",
      "/motions/idle_10.vrma",
      "/motions/idle_11.vrma",
      "/motions/idle_13.vrma",
    ]);
    expect(m.idle_lively.kind).toBe("oneshot");
    expect(m.idle_lively.loop).toBe(false);
    expect(m.idle_lively.broker_publish).toBe(true);
    expect(m.idle_lively.variants.every((path: string) => !m.idle.variants.includes(path))).toBe(
      true,
    );

    const idleVariants = m.idle.variants.filter((path: string) => /idle_\d{2}\.vrma$/.test(path));
    const partition = [...idleVariants, ...m.idle_lively.variants];
    const originalIdleClips = Array.from(
      { length: 13 },
      (_, index) => `/motions/idle_${String(index + 1).padStart(2, "0")}.vrma`,
    );
    expect(partition).toHaveLength(13);
    expect(new Set(partition).size).toBe(13);
    expect([...partition].sort()).toEqual(originalIdleClips);
    expect(m.idle.variants).toContain("/motions/calm.vrma");
    expect(m.idle_lively.variants).not.toContain("/motions/calm.vrma");
  });

  it("passes the real motion registry through validation", () => {
    expect(() => validateMotions("configs/motions.json", m)).not.toThrow();
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

  it("window_sit is a looping state perch that cycles variants seamlessly (no dwell, long fade)", () => {
    expect(m.window_sit).toBeDefined();
    expect(m.window_sit.kind).toBe("state");
    expect(m.window_sit.loop).toBe(true);
    expect(m.window_sit.priority).toBe(55);
    expect(m.window_sit.broker_publish).toBe(false);
    // Seamless cycle: no frozen clamp hold, blended over a long crossfade.
    expect(m.window_sit.cycle_dwell_ms).toBe(0);
    expect(m.window_sit.fade_ms).toBe(700);
    expect(m.window_sit.variant_policy).toBe("random");
    expect(Array.isArray(m.window_sit.variants)).toBe(true);
    expect(m.window_sit.variants.length).toBe(8);
    for (const v of m.window_sit.variants) {
      expect(v, "window_sit.variant").toMatch(/\.vrma$/);
    }
  });

  it("registers the fall sequence: falling (reactive, loop, broker-excluded)", () => {
    expect(m.falling).toBeDefined();
    expect(m.falling.vrma_path).toBe("/motions/falling.vrma");
    expect(m.falling.kind).toBe("reactive");
    expect(m.falling.loop).toBe(true);
    expect(m.falling.priority).toBe(78);
    expect(m.falling.interrupt_policy).toBe("replace");
    expect(m.falling.broker_publish).toBe(false);
  });

  it("registers the fall sequence: landing (oneshot, broker-excluded)", () => {
    expect(m.landing).toBeDefined();
    expect(m.landing.vrma_path).toBe("/motions/landing.vrma");
    expect(m.landing.kind).toBe("oneshot");
    expect(m.landing.loop).toBe(false);
    expect(m.landing.priority).toBe(78);
    expect(m.landing.interrupt_policy).toBe("replace");
    expect(m.landing.broker_publish).toBe(false);
  });

  it.each([
    ["climb_up", "reactive", true],
    ["climb_up_done", "oneshot", false],
    ["climb_down", "reactive", true],
    ["climb_down_landing", "oneshot", false],
  ])("registers the climb clip %s (%s, broker-excluded)", (id, kind, loop) => {
    expect(m[id]).toBeDefined();
    expect(m[id].vrma_path).toBe(`/motions/${id}.vrma`);
    expect(m[id].kind).toBe(kind);
    expect(m[id].loop).toBe(loop);
    expect(m[id].priority).toBe(78);
    expect(m[id].interrupt_policy).toBe("replace");
    expect(m[id].broker_publish).toBe(false);
    // The clips carry their climb as baked hips travel; the window supplies it instead.
    expect(m[id].root_lock_y).toBe(true);
  });

  it("registers jump as a self-ending clip that outranks idle and yields to a pickup", () => {
    expect(m.jump).toBeDefined();
    expect(m.jump.vrma_path).toBe("/motions/jump.vrma");
    // It ends by itself, the convention the other self-ending clips already follow.
    expect(m.jump.kind).toBe("oneshot");
    expect(m.jump.loop).toBe(false);
    // The walk has handed the body back to idle by the time she takes off.
    expect(m.jump.priority).toBeGreaterThan(m.idle.priority);
    expect(m.jump.priority).toBeLessThan(m.drag.priority);
    expect(m.jump.interrupt_policy).toBe("replace");
    expect(m.jump.broker_publish).toBe(false);
  });

  it("locks the root vertically on the climb clips alone", () => {
    const locked = Object.entries(m)
      .filter(([, e]: [string, any]) => e.root_lock_y === true)
      .map(([id]) => id);
    expect(locked.sort()).toEqual([
      "climb_down",
      "climb_down_landing",
      "climb_up",
      "climb_up_done",
    ]);
  });

  it("registers sulk as a broker-published oneshot emotion motion", () => {
    expect(m.suneru).toBeUndefined();
    expect(m.sulk).toBeDefined();
    expect(m.sulk.vrma_path).toBe("/motions/suneru.vrma");
    expect(m.sulk.kind).toBe("oneshot");
    expect(m.sulk.loop).toBe(false);
    expect(m.sulk.priority).toBe(70);
    expect(m.sulk.interrupt_policy).toBe("replace");
    expect(m.sulk.broker_publish).not.toBe(false);
  });

  it("derives a broker-published set that includes sulk and excludes falling/landing/suneru", () => {
    const published = Object.entries(m)
      .filter(
        ([, e]: [string, any]) =>
          e.kind !== "reactive" && e.kind !== "ambient" && e.broker_publish !== false,
      )
      .map(([id]) => id);
    expect(published).toContain("sulk");
    expect(published).not.toContain("falling");
    expect(published).not.toContain("landing");
    expect(published).not.toContain("suneru");
    expect(published).not.toContain("thinking");
    expect(published).not.toContain("peek");
    expect(published).not.toContain("walk");
    expect(published).not.toContain("climb_up_done");
    expect(published).not.toContain("climb_down_landing");
  });

  it("keeps walk out of the agent-triggerable vocabulary the broker publishes", () => {
    expect(agentTriggerableMotionIds(validateMotions("configs/motions.json", m))).not.toContain(
      "walk",
    );
  });

  it("keeps falling below the drag clip so a pickup takes the body mid-fall", () => {
    expect(m.falling.priority).toBeLessThan(m.drag.priority);
  });

  it("registers walk as a looping reactive clip the ambient stroll owns end to end", () => {
    expect(m.walk).toEqual({
      vrma_path: "/motions/walk.vrma",
      kind: "reactive",
      loop: true,
      priority: 45,
      interrupt_policy: "replace",
      broker_publish: false,
    });
  });

  it("keeps walk below thinking so a backend turn takes the clip mid-stroll", () => {
    expect(m.walk.priority).toBeLessThan(m.thinking.priority);
  });

  it("registers the standing-gesture batch as oneshot p70", () => {
    for (const id of ["sheepish", "calm"]) {
      expect(m[id], id).toBeDefined();
      expect(m[id].vrma_path, `${id}.vrma_path`).toMatch(/\.vrma$/);
      expect(m[id].kind, `${id}.kind`).toBe("oneshot");
      expect(m[id].loop, `${id}.loop`).toBe(false);
      expect(m[id].priority, `${id}.priority`).toBe(70);
      expect(m[id].interrupt_policy, `${id}.interrupt_policy`).toBe("replace");
    }
  });

  it("registers peek as a looping held state for side perches", () => {
    expect(m.peek).toEqual({
      vrma_path: "/motions/peek.vrma",
      fade_ms: 700,
      crossfade_loop: true,
      kind: "state",
      loop: true,
      priority: 55,
      interrupt_policy: "replace",
      broker_publish: false,
    });
  });

  it("registers head_pat as a looping reactive pat motion (broker-excluded, p80)", () => {
    expect(m.head_pat).toBeDefined();
    expect(m.head_pat.vrma_path).toBe("/motions/idle_10.vrma");
    expect(m.head_pat.kind).toBe("reactive");
    expect(m.head_pat.loop).toBe(true);
    expect(m.head_pat.pingpong).toBe(true);
    expect(m.head_pat.priority).toBe(80);
    expect(m.head_pat.interrupt_policy).toBe("replace");
    expect(m.head_pat.broker_publish).toBe(false);
  });

  it("registers thinking as a looping state TTFT-filler motion (purchased, broker-excluded, p50)", () => {
    expect(m.thinking).toBeDefined();
    expect(m.thinking.vrma_path).toBe("/purchased_motions/thinking.vrma");
    expect(m.thinking.kind).toBe("state");
    expect(m.thinking.loop).toBe(true);
    expect(m.thinking.priority).toBe(50);
    expect(m.thinking.interrupt_policy).toBe("ignore");
    expect(m.thinking.fade_ms).toBe(200);
    expect(m.thinking.broker_publish).toBe(false);
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
