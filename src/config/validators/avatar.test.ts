import { describe, expect, it } from "vitest";
import { validateAvatar } from "./avatar";
import { ConfigError } from "./shared";

const FILE = "avatar.json";

function expectIssue(raw: unknown, fragment: string): void {
  try {
    validateAvatar(FILE, raw);
    expect.unreachable("validateAvatar should have thrown");
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

describe("validateAvatar — happy path", () => {
  it("accepts a bare vrm_url", () => {
    const out = validateAvatar(FILE, { vrm_url: "/vrms/carlotta.vrm" });
    expect(out).toEqual({
      vrm_url: "/vrms/carlotta.vrm",
      peek: {
        side_out_frac: 0.28,
        side_in_frac: 0.23,
        inset_frac: 0.12,
        mirror_side: "right",
      },
      tap: {
        spam_count: 4,
        spam_window_ms: 3000,
        region_radius_frac: 0.18,
        region_motions: { head: "head_pat", chest: "embarrassed", hips: "embarrassed" },
        bored_cue: { label: "bored poking" },
        touch_cue_cooldown_ms: 60_000,
        touch_emotion_hold_ms: 4000,
        pat_hold_ms: 300,
      },
      drag_hold_ms: 5000,
      gesture_cues: {
        drag_held: { label: "dragged around" },
        window_sit: { label: "sat on window" },
        peek: { label: "peeking" },
        dropped: { label: "dropped from mid-air" },
      },
      walk: {
        interval_min_ms: 30_000,
        interval_max_ms: 60_000,
        distance_min_px: 200,
        distance_max_px: 600,
        floor_tolerance_px: 24,
      },
      fall: {
        gravity_px_s2: 1600,
        max_speed_px_s: 1200,
        min_drop_frac: 0.2,
        cue_cooldown_ms: 60_000,
      },
      climb: {
        interval_min_ms: 90_000,
        interval_max_ms: 180_000,
        perch_dwell_min_ms: 60_000,
        perch_dwell_max_ms: 120_000,
        max_height_frac: 4,
        hang_frac: 0.3,
        wall_offset_frac: 0.3,
        ledge_walk_min_frac: 0.5,
        ledge_walk_max_frac: 1.5,
      },
    });
  });

  it("accepts an available[] manifest with distinct ids", () => {
    const raw = {
      vrm_url: "/vrms/carlotta.vrm",
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
        { id: "custom.1", label: "Custom", url: "/vrms/custom.vrm", source: "user" },
      ],
    };
    const out = validateAvatar(FILE, raw);
    expect(out.available).toEqual(raw.available);
  });

  it("accepts partial framing/hit_test/gaze knobs", () => {
    const raw = {
      vrm_url: "/vrms/carlotta.vrm",
      framing: { margin: 0.1, fov: 30 },
      hit_test: {
        hysteresis_margin_px: 4,
        poll_interval_ms: 100,
        debounce_samples: 2,
        alpha_threshold: 0.5,
      },
      gaze: {
        deadDeg: 0,
        headEngageDeg: 10,
        disengageDeg: 15,
        maxHeadYaw: 45,
        maxHeadPitch: 20,
        eyeMaxDeg: 15,
        headNeckSplit: 0.6,
        smooth: 120,
      },
    };
    const out = validateAvatar(FILE, raw);
    expect(out.framing).toEqual(raw.framing);
    expect(out.hit_test).toEqual(raw.hit_test);
    expect(out.gaze).toEqual(raw.gaze);
  });
});

describe("validateAvatar — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "객체가 아님");
    expectIssue("x", "객체가 아님");
    expectIssue(null, "객체가 아님");
  });

  it("rejects a missing vrm_url", () => {
    expectIssue({}, "vrm_url은 비어 있지 않은 문자열이어야 함");
  });

  it("rejects an empty vrm_url", () => {
    expectIssue({ vrm_url: "" }, "vrm_url은 비어 있지 않은 문자열이어야 함");
  });

  it("rejects a non-string vrm_url", () => {
    expectIssue({ vrm_url: 1 }, "vrm_url은 비어 있지 않은 문자열이어야 함");
  });
});

describe("validateAvatar — available[]", () => {
  it("rejects available that isn't an array", () => {
    expectIssue({ vrm_url: "/v.vrm", available: "nope" }, "available은 배열이어야 함");
  });

  it("rejects a non-object entry", () => {
    expectIssue({ vrm_url: "/v.vrm", available: ["nope"] }, "available[0]: 항목이 객체가 아님");
  });

  it("rejects an entry missing id/label/url", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a" }] },
      "available[0].label는 비어 있지 않은 문자열이어야 함",
    );
  });

  it("rejects an entry with an empty label", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a", label: "", url: "/a.vrm" }] },
      "available[0].label는 비어 있지 않은 문자열이어야 함",
    );
  });

  it("rejects an id with disallowed characters", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a b", label: "A", url: "/a.vrm" }] },
      "available[0].id는 [A-Za-z0-9._-]만 허용",
    );
  });

  it("rejects an unknown source", () => {
    expectIssue(
      { vrm_url: "/v.vrm", available: [{ id: "a", label: "A", url: "/a.vrm", source: "cdn" }] },
      "available[0].source는",
    );
  });

  it("rejects duplicate ids", () => {
    expectIssue(
      {
        vrm_url: "/v.vrm",
        available: [
          { id: "a", label: "A", url: "/a.vrm" },
          { id: "a", label: "A2", url: "/a2.vrm" },
        ],
      },
      "available[1].id 중복",
    );
  });
});

describe("validateAvatar — framing", () => {
  it("rejects a non-object framing", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: "nope" }, "framing은 객체여야 함");
  });

  it("rejects a negative margin", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: { margin: -1 } }, "framing.margin은 0 이상");
  });

  it("rejects fov <= 0", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: { fov: 0 } }, "framing.fov는 (0, 180)");
  });

  it("rejects fov >= 180", () => {
    expectIssue({ vrm_url: "/v.vrm", framing: { fov: 180 } }, "framing.fov는 (0, 180)");
  });
});

describe("validateAvatar — hit_test", () => {
  it("rejects a non-object hit_test", () => {
    expectIssue({ vrm_url: "/v.vrm", hit_test: "nope" }, "hit_test은 객체여야 함");
  });

  it("rejects a negative hysteresis_margin_px", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { hysteresis_margin_px: -1 } },
      "hit_test.hysteresis_margin_px는 0 이상",
    );
  });

  it("rejects poll_interval_ms <= 0 (exclusive minimum)", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { poll_interval_ms: 0 } },
      "hit_test.poll_interval_ms는 0보다 큰",
    );
  });

  it("rejects a non-integer debounce_samples", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { debounce_samples: 1.5 } },
      "hit_test.debounce_samples는 1 이상 정수여야 함",
    );
  });

  it("rejects debounce_samples below 1", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { debounce_samples: 0 } },
      "hit_test.debounce_samples는 1 이상 정수여야 함",
    );
  });

  it("rejects alpha_threshold outside (0, 1]", () => {
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { alpha_threshold: 0 } },
      "hit_test.alpha_threshold는 (0, 1]",
    );
    expectIssue(
      { vrm_url: "/v.vrm", hit_test: { alpha_threshold: 1.5 } },
      "hit_test.alpha_threshold는 (0, 1]",
    );
  });
});

describe("validateAvatar — tap", () => {
  it("merges partial tap blocks over defaults", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      tap: {
        spam_count: 6,
        region_motions: { hips: "wave" },
        bored_cue: { label: "custom label" },
      },
    });

    expect(out.tap).toEqual({
      spam_count: 6,
      spam_window_ms: 3000,
      region_radius_frac: 0.18,
      region_motions: { head: "head_pat", chest: "embarrassed", hips: "wave" },
      bored_cue: { label: "custom label" },
      touch_cue_cooldown_ms: 60_000,
      touch_emotion_hold_ms: 4000,
      pat_hold_ms: 300,
    });
  });

  it("rejects a non-object tap block", () => {
    expectIssue({ vrm_url: "/v.vrm", tap: "nope" }, "tap은 객체여야 함");
  });

  it.each([1, 2.5, Number.NaN, "4"])("rejects invalid spam_count: %s", (spam_count) => {
    expectIssue({ vrm_url: "/v.vrm", tap: { spam_count } }, "tap.spam_count는 2 이상 정수");
  });

  it.each([0, 60001, 1.5, "3000"])("rejects invalid spam_window_ms: %s", (spam_window_ms) => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { spam_window_ms } },
      "tap.spam_window_ms는 1..60000 범위 정수",
    );
  });

  it.each([
    0,
    1.01,
    Number.NaN,
    "0.18",
  ])("rejects invalid region_radius_frac: %s", (region_radius_frac) => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_radius_frac } },
      "tap.region_radius_frac는 (0, 1]",
    );
  });

  it("accepts inclusive numeric boundaries", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      tap: { spam_count: 2, spam_window_ms: 60_000, region_radius_frac: 1 },
    });

    expect(out.tap).toMatchObject({ spam_count: 2, spam_window_ms: 60_000, region_radius_frac: 1 });
    expect(
      validateAvatar(FILE, { vrm_url: "/v.vrm", tap: { spam_window_ms: 1 } }).tap.spam_window_ms,
    ).toBe(1);
  });

  it("rejects invalid or unknown region motion entries", () => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_motions: [] } },
      "tap.region_motions은 객체여야 함",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_motions: { feet: "wave" } } },
      "tap.region_motions.feet는 허용되지 않는 키",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_motions: { chest: "" } } },
      "tap.region_motions.chest는 비어 있지 않은 문자열",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_motions: { hips: 1 } } },
      "tap.region_motions.hips는 비어 있지 않은 문자열",
    );
  });

  it("rejects a non-object bored_cue", () => {
    expectIssue({ vrm_url: "/v.vrm", tap: { bored_cue: "nope" } }, "tap.bored_cue은 객체여야 함");
  });

  it.each([
    ["label", ""],
    ["label", 1],
    ["context", ""],
    ["context", 1],
  ] as const)("rejects an empty or non-string bored_cue.%s", (field, value) => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { bored_cue: { [field]: value } } },
      `tap.bored_cue.${field}는 비어 있지 않은 문자열`,
    );
  });
});

describe("validateAvatar — tap touch reactions", () => {
  it("applies touch defaults and leaves cues/emotions undefined when absent", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", tap: { spam_count: 3 } });
    expect(out.tap.touch_cue_cooldown_ms).toBe(60_000);
    expect(out.tap.touch_emotion_hold_ms).toBe(4_000);
    expect(out.tap.region_emotions).toBeUndefined();
    expect(out.tap.region_cues).toBeUndefined();
  });

  it("keeps configured region_emotions, region_cues, and touch timing knobs", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      tap: {
        region_emotions: { chest: "embarrassed" },
        region_cues: { hips: { label: "butt poked", context: "React in character." } },
        touch_cue_cooldown_ms: 1_000,
        touch_emotion_hold_ms: 250,
      },
    });
    expect(out.tap.region_emotions).toEqual({ chest: "embarrassed" });
    expect(out.tap.region_cues).toEqual({
      hips: { label: "butt poked", context: "React in character." },
    });
    expect(out.tap.touch_cue_cooldown_ms).toBe(1_000);
    expect(out.tap.touch_emotion_hold_ms).toBe(250);
  });

  it("rejects invalid or unknown region emotion entries", () => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_emotions: [] } },
      "tap.region_emotions은 객체여야 함",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_emotions: { feet: "happy" } } },
      "tap.region_emotions.feet는 허용되지 않는 키",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_emotions: { chest: "" } } },
      "tap.region_emotions.chest는 비어 있지 않은 문자열",
    );
  });

  it("rejects malformed region_cues", () => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_cues: "nope" } },
      "tap.region_cues은 객체여야 함",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_cues: { feet: { label: "a", context: "b" } } } },
      "tap.region_cues.feet는 허용되지 않는 키",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_cues: { chest: "nope" } } },
      "tap.region_cues.chest는 객체여야 함",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_cues: { chest: { label: "", context: "b" } } } },
      "tap.region_cues.chest",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_cues: { chest: {} } } },
      "tap.region_cues.chest",
    );
    expectIssue(
      { vrm_url: "/v.vrm", tap: { region_cues: { chest: { label: "a", context: "" } } } },
      "tap.region_cues.chest",
    );
  });

  it("accepts a label-only region cue", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      tap: { region_cues: { chest: { label: "chest poked" } } },
    });
    expect(out.tap.region_cues).toEqual({ chest: { label: "chest poked" } });
  });

  it.each([-1, 1.5, "0"])("rejects invalid touch_cue_cooldown_ms: %s", (touch_cue_cooldown_ms) => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { touch_cue_cooldown_ms } },
      "tap.touch_cue_cooldown_ms는 0 이상 정수",
    );
  });

  it.each([
    0,
    1.5,
    "4000",
  ])("rejects invalid touch_emotion_hold_ms: %s", (touch_emotion_hold_ms) => {
    expectIssue(
      { vrm_url: "/v.vrm", tap: { touch_emotion_hold_ms } },
      "tap.touch_emotion_hold_ms는 1 이상 정수",
    );
  });

  it("keeps the head region across motions, emotions, and cues", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      tap: {
        region_motions: { head: "head_pat" },
        region_emotions: { head: "relaxed" },
        region_cues: { head: { label: "head patted" } },
      },
    });
    expect(out.tap.region_motions.head).toBe("head_pat");
    expect(out.tap.region_emotions).toEqual({ head: "relaxed" });
    expect(out.tap.region_cues).toEqual({ head: { label: "head patted" } });
  });

  it("keeps a configured pat_hold_ms", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", tap: { pat_hold_ms: 500 } });
    expect(out.tap.pat_hold_ms).toBe(500);
  });

  it.each([0, 1.5, "300"])("rejects invalid pat_hold_ms: %s", (pat_hold_ms) => {
    expectIssue({ vrm_url: "/v.vrm", tap: { pat_hold_ms } }, "tap.pat_hold_ms는 1 이상 정수");
  });

  it("accepts a zero cooldown", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", tap: { touch_cue_cooldown_ms: 0 } });
    expect(out.tap.touch_cue_cooldown_ms).toBe(0);
  });
});

describe("validateAvatar — peek", () => {
  it("merges partial peek blocks over defaults", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      peek: { side_out_frac: 0.5, mirror_side: "left" },
    });

    expect(out.peek).toEqual({
      side_out_frac: 0.5,
      side_in_frac: 0.23,
      inset_frac: 0.12,
      mirror_side: "left",
    });
  });

  it("rejects a non-object peek block", () => {
    expectIssue({ vrm_url: "/v.vrm", peek: "nope" }, "peek은 객체여야 함");
  });

  it.each([
    ["side_out_frac", 0],
    ["side_out_frac", 2.01],
    ["side_in_frac", Number.NaN],
    ["side_in_frac", "0.23"],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue({ vrm_url: "/v.vrm", peek: { [field]: value } }, `peek.${field}는 (0, 2]`);
  });

  it.each([
    -0.01,
    1.01,
    Number.POSITIVE_INFINITY,
    "0.12",
  ])("rejects invalid inset_frac: %s", (inset_frac) => {
    expectIssue({ vrm_url: "/v.vrm", peek: { inset_frac } }, "peek.inset_frac는 [0, 1]");
  });

  it.each(["up", true, 1])("rejects invalid mirror_side: %s", (mirror_side) => {
    expectIssue({ vrm_url: "/v.vrm", peek: { mirror_side } }, "peek.mirror_side는 left|right|none");
  });
});

describe("validateAvatar — walk", () => {
  it("merges partial walk blocks over defaults", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      walk: { interval_min_ms: 10_000, distance_max_px: 500 },
    });

    expect(out.walk).toEqual({
      interval_min_ms: 10_000,
      interval_max_ms: 60_000,
      distance_min_px: 200,
      distance_max_px: 500,
      floor_tolerance_px: 24,
    });
  });

  it("rejects a non-object walk block", () => {
    expectIssue({ vrm_url: "/v.vrm", walk: "nope" }, "walk은 객체여야 함");
  });

  it.each([
    ["interval_min_ms", 0],
    ["interval_min_ms", -1],
    ["interval_max_ms", "60000"],
    ["distance_min_px", Number.NaN],
    ["distance_max_px", 0],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue({ vrm_url: "/v.vrm", walk: { [field]: value } }, `walk.${field}는 0보다 큰`);
  });

  it.each([
    -1,
    "8",
    Number.POSITIVE_INFINITY,
  ])("rejects invalid floor_tolerance_px: %s", (floor_tolerance_px) => {
    expectIssue(
      { vrm_url: "/v.vrm", walk: { floor_tolerance_px } },
      "walk.floor_tolerance_px는 0 이상",
    );
  });

  it("rejects an inverted interval range", () => {
    expectIssue(
      { vrm_url: "/v.vrm", walk: { interval_min_ms: 200_000 } },
      "walk.interval_min_ms는 walk.interval_max_ms 이하",
    );
  });

  it("rejects an inverted distance range", () => {
    expectIssue(
      { vrm_url: "/v.vrm", walk: { distance_min_px: 700 } },
      "walk.distance_min_px는 walk.distance_max_px 이하",
    );
  });
});

describe("validateAvatar — fall", () => {
  it("merges a partial fall block over defaults", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      fall: { gravity_px_s2: 1200, min_drop_frac: 0.5 },
    });

    expect(out.fall).toEqual({
      gravity_px_s2: 1200,
      max_speed_px_s: 1200,
      min_drop_frac: 0.5,
      cue_cooldown_ms: 60_000,
    });
  });

  it("rejects a non-object fall block", () => {
    expectIssue({ vrm_url: "/v.vrm", fall: "nope" }, "fall은 객체여야 함");
  });

  it.each([
    ["gravity_px_s2", 0],
    ["gravity_px_s2", -1],
    ["max_speed_px_s", "1800"],
    ["max_speed_px_s", Number.POSITIVE_INFINITY],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue({ vrm_url: "/v.vrm", fall: { [field]: value } }, `fall.${field}는 0보다 큰`);
  });

  it.each([
    -0.1,
    1.5,
    "0.2",
    Number.NaN,
  ])("rejects a min_drop_frac outside [0, 1]: %s", (min_drop_frac) => {
    expectIssue({ vrm_url: "/v.vrm", fall: { min_drop_frac } }, "fall.min_drop_frac는 [0, 1]");
  });

  it("accepts the boundary fractions", () => {
    expect(
      validateAvatar(FILE, { vrm_url: "/v.vrm", fall: { min_drop_frac: 0 } }).fall.min_drop_frac,
    ).toBe(0);
    expect(
      validateAvatar(FILE, { vrm_url: "/v.vrm", fall: { min_drop_frac: 1 } }).fall.min_drop_frac,
    ).toBe(1);
  });

  it.each([-1, "60000", 1.5])("rejects an invalid cue_cooldown_ms: %s", (cue_cooldown_ms) => {
    expectIssue({ vrm_url: "/v.vrm", fall: { cue_cooldown_ms } }, "fall.cue_cooldown_ms는 0 이상");
  });
});

describe("validateAvatar — climb", () => {
  it("merges a partial climb block over defaults", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      climb: { interval_min_ms: 30_000, hang_frac: 0.4 },
    });

    expect(out.climb).toEqual({
      interval_min_ms: 30_000,
      interval_max_ms: 180_000,
      perch_dwell_min_ms: 60_000,
      perch_dwell_max_ms: 120_000,
      max_height_frac: 4,
      hang_frac: 0.4,
      wall_offset_frac: 0.3,
      ledge_walk_min_frac: 0.5,
      ledge_walk_max_frac: 1.5,
    });
  });

  it("rejects a non-object climb block", () => {
    expectIssue({ vrm_url: "/v.vrm", climb: "nope" }, "climb은 객체여야 함");
  });

  it.each([
    ["interval_min_ms", -1],
    ["interval_max_ms", "180000"],
    ["perch_dwell_min_ms", 1.5],
    ["perch_dwell_max_ms", Number.NaN],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue({ vrm_url: "/v.vrm", climb: { [field]: value } }, `climb.${field}는 0 이상 정수`);
  });

  it.each([
    ["max_height_frac", 0],
    ["hang_frac", -0.1],
    ["wall_offset_frac", "0.15"],
    ["ledge_walk_min_frac", 0],
    ["ledge_walk_max_frac", Number.POSITIVE_INFINITY],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue({ vrm_url: "/v.vrm", climb: { [field]: value } }, `climb.${field}는 0보다 큰`);
  });

  it("rejects an inverted interval range", () => {
    expectIssue(
      { vrm_url: "/v.vrm", climb: { interval_min_ms: 200_000 } },
      "climb.interval_min_ms는 climb.interval_max_ms 이하",
    );
  });

  it("rejects an inverted dwell range", () => {
    expectIssue(
      { vrm_url: "/v.vrm", climb: { perch_dwell_min_ms: 200_000 } },
      "climb.perch_dwell_min_ms는 climb.perch_dwell_max_ms 이하",
    );
  });

  it("rejects an inverted ledge-walk range", () => {
    expectIssue(
      { vrm_url: "/v.vrm", climb: { ledge_walk_min_frac: 2 } },
      "climb.ledge_walk_min_frac는 climb.ledge_walk_max_frac 이하",
    );
  });
});

describe("validateAvatar — drag_hold_ms", () => {
  it("defaults to 5000 when absent", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm" });
    expect(out.drag_hold_ms).toBe(5000);
  });

  it("accepts a configured value", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", drag_hold_ms: 3000 });
    expect(out.drag_hold_ms).toBe(3000);
  });

  it.each([0, -1, 1.5, "5000", Number.NaN])("rejects invalid drag_hold_ms: %s", (drag_hold_ms) => {
    expectIssue({ vrm_url: "/v.vrm", drag_hold_ms }, "drag_hold_ms는 1 이상 정수");
  });
});

describe("validateAvatar — gesture_cues", () => {
  const FULL = {
    drag_held: { label: "dragged around", context: "put me down" },
    window_sit: { label: "sat on window", context: "say something" },
    peek: { label: "peeking", context: "say something playful" },
    dropped: { label: "dropped from mid-air", context: "say something startled" },
  };

  it("defaults to the authored label-only cues when absent", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm" });
    expect(out.gesture_cues).toEqual({
      drag_held: { label: "dragged around" },
      window_sit: { label: "sat on window" },
      peek: { label: "peeking" },
      dropped: { label: "dropped from mid-air" },
    });
  });

  it("merges a partial gesture_cues block over defaults", () => {
    const out = validateAvatar(FILE, {
      vrm_url: "/v.vrm",
      gesture_cues: { drag_held: { label: "held too long", context: "put me down now" } },
    });
    expect(out.gesture_cues.drag_held).toEqual({
      label: "held too long",
      context: "put me down now",
    });
    expect(out.gesture_cues.window_sit.label).toBe("sat on window");
  });

  it("accepts a full gesture_cues block", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", gesture_cues: FULL });
    expect(out.gesture_cues).toEqual(FULL);
  });

  it("rejects a non-object gesture_cues block", () => {
    expectIssue({ vrm_url: "/v.vrm", gesture_cues: "nope" }, "gesture_cues은 객체여야 함");
  });

  it("rejects an unknown gesture_cues key", () => {
    expectIssue(
      { vrm_url: "/v.vrm", gesture_cues: { tap_bored: { label: "a", context: "b" } } },
      "gesture_cues.tap_bored는 허용되지 않는 키",
    );
  });

  it("rejects a non-object cue entry", () => {
    expectIssue(
      { vrm_url: "/v.vrm", gesture_cues: { drag_held: "nope" } },
      "gesture_cues.drag_held는 객체여야 함",
    );
  });

  it.each([
    ["label", ""],
    ["label", 1],
    ["context", ""],
    ["context", 1],
  ] as const)("rejects an empty or non-string gesture_cues.drag_held.%s", (field, value) => {
    expectIssue(
      { vrm_url: "/v.vrm", gesture_cues: { drag_held: { [field]: value } } },
      `gesture_cues.drag_held.${field}는 비어 있지 않은 문자열`,
    );
  });
});

describe("validateAvatar — gaze", () => {
  it("rejects a non-object gaze", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: "nope" }, "gaze는 객체여야 함");
  });

  it("accepts deadDeg:0 (inclusive lower bound)", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", gaze: { deadDeg: 0 } });
    expect(out.gaze?.deadDeg).toBe(0);
  });

  it("rejects headEngageDeg:0 (exclusive lower bound)", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { headEngageDeg: 0 } }, "gaze.headEngageDeg는");
  });

  it("rejects maxHeadYaw above 90", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { maxHeadYaw: 91 } }, "gaze.maxHeadYaw는");
  });

  it("rejects headNeckSplit outside [0, 1]", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { headNeckSplit: 1.1 } }, "gaze.headNeckSplit는");
  });

  it("accepts headNeckSplit:0 (inclusive lower bound)", () => {
    const out = validateAvatar(FILE, { vrm_url: "/v.vrm", gaze: { headNeckSplit: 0 } });
    expect(out.gaze?.headNeckSplit).toBe(0);
  });

  it("rejects smooth above 1000", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { smooth: 1001 } }, "gaze.smooth는");
  });

  it("rejects a non-finite gaze value", () => {
    expectIssue({ vrm_url: "/v.vrm", gaze: { eyeMaxDeg: Number.NaN } }, "gaze.eyeMaxDeg는");
  });
});
