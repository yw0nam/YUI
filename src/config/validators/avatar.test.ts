import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { avatarFixture } from "../load-test-helpers";
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

/** True for a plain object (not an array). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `base` with `overrides` merged in, recursing into nested objects. */
function merge(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const current = out[key];
    out[key] = isPlainObject(current) && isPlainObject(value) ? merge(current, value) : value;
  }
  return out;
}

/** A valid file with `overrides` merged in — each case declares only what it tests. */
function avatarWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return merge(avatarFixture() as unknown as Record<string, unknown>, overrides);
}

/** Every dotted path under `node`, parents before their children. */
function tunablePaths(node: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.push(path);
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      out.push(...tunablePaths(value as Record<string, unknown>, path));
    }
  }
  return out;
}

/** The fixture with one dotted path removed. */
function without(path: string): Record<string, unknown> {
  const raw = avatarFixture() as unknown as Record<string, unknown>;
  const parts = path.split(".");
  let node = raw;
  for (const part of parts.slice(0, -1)) node = node[part] as Record<string, unknown>;
  delete node[parts[parts.length - 1]];
  return raw;
}

/** Every tunable the file owns — vrm_url has its own cases. */
const TUNABLE_PATHS = tunablePaths(avatarFixture() as unknown as Record<string, unknown>).filter(
  (path) => path !== "vrm_url",
);

describe("validateAvatar — configs/avatar.json owns every tunable", () => {
  it.each(TUNABLE_PATHS)("names %s when it is absent", (path) => {
    expectIssue(without(path), path);
  });

  it("accepts a file with region_emotions and region_cues left out", () => {
    const raw = avatarFixture() as unknown as Record<string, unknown>;
    const out = validateAvatar(FILE, raw);
    expect(out.tap.region_emotions).toBeUndefined();
    expect(out.tap.region_cues).toBeUndefined();
  });
});

describe("validateAvatar — happy path", () => {
  it("returns every section the file declares, unchanged", () => {
    expect(validateAvatar(FILE, avatarWith({}))).toEqual(avatarFixture());
  });

  it("accepts an available[] manifest with distinct ids", () => {
    const available = [
      { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
      { id: "custom.1", label: "Custom", url: "/vrms/custom.vrm", source: "user" },
    ];
    expect(validateAvatar(FILE, avatarWith({ available })).available).toEqual(available);
  });

  it("keeps the framing/hit_test/gaze knobs the file declares", () => {
    const raw = avatarWith({
      framing: { margin: 0.2, fov: 45 },
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
    });
    const out = validateAvatar(FILE, raw);
    expect(out.framing).toEqual(raw.framing);
    expect(out.hit_test).toEqual(raw.hit_test);
    expect(out.gaze).toEqual(raw.gaze);
  });
});

describe("validateAvatar — top-level shape", () => {
  it("rejects non-object raw", () => {
    expectIssue([], "not an object");
    expectIssue("x", "not an object");
    expectIssue(null, "not an object");
  });

  it("rejects a missing vrm_url", () => {
    expectIssue({}, "vrm_url must be a non-empty string");
  });

  it("rejects an empty vrm_url", () => {
    expectIssue({ vrm_url: "" }, "vrm_url must be a non-empty string");
  });

  it("rejects a non-string vrm_url", () => {
    expectIssue({ vrm_url: 1 }, "vrm_url must be a non-empty string");
  });
});

describe("validateAvatar — available[]", () => {
  it("rejects available that isn't an array", () => {
    expectIssue(avatarWith({ available: "nope" }), "available must be an array");
  });

  it("rejects a non-object entry", () => {
    expectIssue(avatarWith({ available: ["nope"] }), "available[0]: entry is not an object");
  });

  it("rejects an entry missing id/label/url", () => {
    expectIssue(
      avatarWith({ available: [{ id: "a" }] }),
      "available[0].label must be a non-empty string",
    );
  });

  it("rejects an entry with an empty label", () => {
    expectIssue(
      avatarWith({ available: [{ id: "a", label: "", url: "/a.vrm" }] }),
      "available[0].label must be a non-empty string",
    );
  });

  it("rejects an id with disallowed characters", () => {
    expectIssue(
      avatarWith({ available: [{ id: "a b", label: "A", url: "/a.vrm" }] }),
      "available[0].id must contain only [A-Za-z0-9._-]",
    );
  });

  it("rejects an unknown source", () => {
    expectIssue(
      avatarWith({ available: [{ id: "a", label: "A", url: "/a.vrm", source: "cdn" }] }),
      "available[0].source must be",
    );
  });

  it("rejects duplicate ids", () => {
    expectIssue(
      avatarWith({
        available: [
          { id: "a", label: "A", url: "/a.vrm" },
          { id: "a", label: "A2", url: "/a2.vrm" },
        ],
      }),
      "available[1].id is a duplicate",
    );
  });
});

describe("validateAvatar — framing", () => {
  it("rejects a non-object framing", () => {
    expectIssue(avatarWith({ framing: "nope" }), "framing must be an object");
  });

  it("rejects a negative margin", () => {
    expectIssue(
      avatarWith({ framing: { margin: -1 } }),
      "framing.margin must be a finite number >= 0",
    );
  });

  it("rejects fov <= 0", () => {
    expectIssue(
      avatarWith({ framing: { fov: 0 } }),
      "framing.fov must be a finite number in (0, 180)",
    );
  });

  it("rejects fov >= 180", () => {
    expectIssue(
      avatarWith({ framing: { fov: 180 } }),
      "framing.fov must be a finite number in (0, 180)",
    );
  });

  it("rejects a missing upper_body", () => {
    const raw = avatarFixture() as unknown as Record<string, unknown>;
    raw.framing = { margin: 0.1, fov: 30 };
    expectIssue(raw, "framing.upper_body must be an object");
  });

  it("rejects an upper_body band out of order or out of [0, 1]", () => {
    expectIssue(
      avatarWith({ framing: { upper_body: { from_frac: 0.6, to_frac: 0.5 } } }),
      "framing.upper_body.from_frac must be <",
    );
    expectIssue(
      avatarWith({ framing: { upper_body: { from_frac: -0.1, to_frac: 1 } } }),
      "framing.upper_body.from_frac must be a finite number in [0, 1]",
    );
  });
});

describe("validateAvatar — hit_test", () => {
  it("rejects a non-object hit_test", () => {
    expectIssue(avatarWith({ hit_test: "nope" }), "hit_test must be an object");
  });

  it("rejects a negative hysteresis_margin_px", () => {
    expectIssue(
      avatarWith({ hit_test: { hysteresis_margin_px: -1 } }),
      "hit_test.hysteresis_margin_px must be a finite number >= 0",
    );
  });

  it("rejects poll_interval_ms <= 0 (exclusive minimum)", () => {
    expectIssue(
      avatarWith({ hit_test: { poll_interval_ms: 0 } }),
      "hit_test.poll_interval_ms must be a finite number > 0",
    );
  });

  it("rejects a non-integer debounce_samples", () => {
    expectIssue(
      avatarWith({ hit_test: { debounce_samples: 1.5 } }),
      "hit_test.debounce_samples must be an integer >= 1",
    );
  });

  it("rejects debounce_samples below 1", () => {
    expectIssue(
      avatarWith({ hit_test: { debounce_samples: 0 } }),
      "hit_test.debounce_samples must be an integer >= 1",
    );
  });

  it("rejects alpha_threshold outside (0, 1]", () => {
    expectIssue(
      avatarWith({ hit_test: { alpha_threshold: 0 } }),
      "hit_test.alpha_threshold must be a finite number in (0, 1]",
    );
    expectIssue(
      avatarWith({ hit_test: { alpha_threshold: 1.5 } }),
      "hit_test.alpha_threshold must be a finite number in (0, 1]",
    );
  });
});

describe("validateAvatar — tap", () => {
  it("keeps every tap key the file declares", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({
        tap: {
          spam_count: 6,
          region_motions: { hips: "wave" },
          bored_cue: { label: "custom label" },
        },
      }),
    );

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
    expectIssue(avatarWith({ tap: "nope" }), "tap must be an object");
  });

  it.each([1, 2.5, Number.NaN, "4"])("rejects invalid spam_count: %s", (spam_count) => {
    expectIssue(avatarWith({ tap: { spam_count } }), "tap.spam_count must be an integer >= 2");
  });

  it.each([0, 60001, 1.5, "3000"])("rejects invalid spam_window_ms: %s", (spam_window_ms) => {
    expectIssue(
      avatarWith({ tap: { spam_window_ms } }),
      "tap.spam_window_ms must be an integer in [1, 60000]",
    );
  });

  it.each([
    0,
    1.01,
    Number.NaN,
    "0.18",
  ])("rejects invalid region_radius_frac: %s", (region_radius_frac) => {
    expectIssue(
      avatarWith({ tap: { region_radius_frac } }),
      "tap.region_radius_frac must be a finite number in (0, 1]",
    );
  });

  it("accepts inclusive numeric boundaries", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ tap: { spam_count: 2, spam_window_ms: 60_000, region_radius_frac: 1 } }),
    );

    expect(out.tap).toMatchObject({ spam_count: 2, spam_window_ms: 60_000, region_radius_frac: 1 });
    expect(
      validateAvatar(FILE, avatarWith({ tap: { spam_window_ms: 1 } })).tap.spam_window_ms,
    ).toBe(1);
  });

  it("rejects invalid or unknown region motion entries", () => {
    expectIssue(
      avatarWith({ tap: { region_motions: [] } }),
      "tap.region_motions must be an object",
    );
    expectIssue(
      avatarWith({ tap: { region_motions: { feet: "wave" } } }),
      "tap.region_motions.feet is an unknown key",
    );
    expectIssue(
      avatarWith({ tap: { region_motions: { chest: "" } } }),
      "tap.region_motions.chest must be a non-empty string",
    );
    expectIssue(
      avatarWith({ tap: { region_motions: { hips: 1 } } }),
      "tap.region_motions.hips must be a non-empty string",
    );
  });

  it("rejects a non-object bored_cue", () => {
    expectIssue(avatarWith({ tap: { bored_cue: "nope" } }), "tap.bored_cue must be an object");
  });

  it.each([
    ["label", ""],
    ["label", 1],
    ["context", ""],
    ["context", 1],
  ] as const)("rejects an empty or non-string bored_cue.%s", (field, value) => {
    expectIssue(
      avatarWith({ tap: { bored_cue: { [field]: value } } }),
      `tap.bored_cue.${field} must be a non-empty string`,
    );
  });
});

describe("validateAvatar — tap touch reactions", () => {
  it("keeps configured region_emotions, region_cues, and touch timing knobs", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({
        tap: {
          region_emotions: { chest: "embarrassed" },
          region_cues: { hips: { label: "butt poked", context: "React in character." } },
          touch_cue_cooldown_ms: 1_000,
          touch_emotion_hold_ms: 250,
        },
      }),
    );
    expect(out.tap.region_emotions).toEqual({ chest: "embarrassed" });
    expect(out.tap.region_cues).toEqual({
      hips: { label: "butt poked", context: "React in character." },
    });
    expect(out.tap.touch_cue_cooldown_ms).toBe(1_000);
    expect(out.tap.touch_emotion_hold_ms).toBe(250);
  });

  it("rejects invalid or unknown region emotion entries", () => {
    expectIssue(
      avatarWith({ tap: { region_emotions: [] } }),
      "tap.region_emotions must be an object",
    );
    expectIssue(
      avatarWith({ tap: { region_emotions: { feet: "happy" } } }),
      "tap.region_emotions.feet is an unknown key",
    );
    expectIssue(
      avatarWith({ tap: { region_emotions: { chest: "" } } }),
      "tap.region_emotions.chest must be a non-empty string",
    );
  });

  it("rejects malformed region_cues", () => {
    expectIssue(avatarWith({ tap: { region_cues: "nope" } }), "tap.region_cues must be an object");
    expectIssue(
      avatarWith({ tap: { region_cues: { feet: { label: "a", context: "b" } } } }),
      "tap.region_cues.feet is an unknown key",
    );
    expectIssue(
      avatarWith({ tap: { region_cues: { chest: "nope" } } }),
      "tap.region_cues.chest must be an object",
    );
    expectIssue(
      avatarWith({ tap: { region_cues: { chest: { label: "", context: "b" } } } }),
      "tap.region_cues.chest",
    );
    expectIssue(avatarWith({ tap: { region_cues: { chest: {} } } }), "tap.region_cues.chest");
    expectIssue(
      avatarWith({ tap: { region_cues: { chest: { label: "a", context: "" } } } }),
      "tap.region_cues.chest",
    );
  });

  it("accepts a label-only region cue", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ tap: { region_cues: { chest: { label: "chest poked" } } } }),
    );
    expect(out.tap.region_cues).toEqual({ chest: { label: "chest poked" } });
  });

  it.each([-1, 1.5, "0"])("rejects invalid touch_cue_cooldown_ms: %s", (touch_cue_cooldown_ms) => {
    expectIssue(
      avatarWith({ tap: { touch_cue_cooldown_ms } }),
      "tap.touch_cue_cooldown_ms must be an integer >= 0",
    );
  });

  it.each([
    0,
    1.5,
    "4000",
  ])("rejects invalid touch_emotion_hold_ms: %s", (touch_emotion_hold_ms) => {
    expectIssue(
      avatarWith({ tap: { touch_emotion_hold_ms } }),
      "tap.touch_emotion_hold_ms must be an integer >= 1",
    );
  });

  it("keeps the head region across motions, emotions, and cues", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({
        tap: {
          region_motions: { head: "head_pat" },
          region_emotions: { head: "relaxed" },
          region_cues: { head: { label: "head patted" } },
        },
      }),
    );
    expect(out.tap.region_motions.head).toBe("head_pat");
    expect(out.tap.region_emotions).toEqual({ head: "relaxed" });
    expect(out.tap.region_cues).toEqual({ head: { label: "head patted" } });
  });

  it("keeps a configured pat_hold_ms", () => {
    const out = validateAvatar(FILE, avatarWith({ tap: { pat_hold_ms: 500 } }));
    expect(out.tap.pat_hold_ms).toBe(500);
  });

  it.each([0, 1.5, "300"])("rejects invalid pat_hold_ms: %s", (pat_hold_ms) => {
    expectIssue(avatarWith({ tap: { pat_hold_ms } }), "tap.pat_hold_ms must be an integer >= 1");
  });

  it("accepts a zero cooldown", () => {
    const out = validateAvatar(FILE, avatarWith({ tap: { touch_cue_cooldown_ms: 0 } }));
    expect(out.tap.touch_cue_cooldown_ms).toBe(0);
  });
});

describe("validateAvatar — peek", () => {
  it("keeps every peek key the file declares", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ peek: { side_out_frac: 0.5, mirror_side: "left" } }),
    );

    expect(out.peek).toEqual({
      side_out_frac: 0.5,
      side_in_frac: 0.23,
      inset_frac: 0.12,
      mirror_side: "left",
    });
  });

  it("rejects a non-object peek block", () => {
    expectIssue(avatarWith({ peek: "nope" }), "peek must be an object");
  });

  it.each([
    ["side_out_frac", 0],
    ["side_out_frac", 2.01],
    ["side_in_frac", Number.NaN],
    ["side_in_frac", "0.23"],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ peek: { [field]: value } }),
      `peek.${field} must be a finite number in (0, 2]`,
    );
  });

  it.each([
    -0.01,
    1.01,
    Number.POSITIVE_INFINITY,
    "0.12",
  ])("rejects invalid inset_frac: %s", (inset_frac) => {
    expectIssue(
      avatarWith({ peek: { inset_frac } }),
      "peek.inset_frac must be a finite number in [0, 1]",
    );
  });

  it.each(["up", true, 1])("rejects invalid mirror_side: %s", (mirror_side) => {
    expectIssue(
      avatarWith({ peek: { mirror_side } }),
      "peek.mirror_side must be one of left|right|none",
    );
  });
});

describe("validateAvatar — walk", () => {
  it("keeps every walk key the file declares", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ walk: { interval_min_ms: 10_000, distance_max_px: 500 } }),
    );

    expect(out.walk).toEqual({
      interval_min_ms: 10_000,
      interval_max_ms: 60_000,
      distance_min_px: 200,
      distance_max_px: 500,
      floor_tolerance_px: 24,
    });
  });

  it("rejects a non-object walk block", () => {
    expectIssue(avatarWith({ walk: "nope" }), "walk must be an object");
  });

  it.each([
    ["interval_min_ms", 0],
    ["interval_min_ms", -1],
    ["interval_max_ms", "60000"],
    ["distance_min_px", Number.NaN],
    ["distance_max_px", 0],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ walk: { [field]: value } }),
      `walk.${field} must be a finite number > 0`,
    );
  });

  it.each([
    -1,
    "8",
    Number.POSITIVE_INFINITY,
  ])("rejects invalid floor_tolerance_px: %s", (floor_tolerance_px) => {
    expectIssue(
      avatarWith({ walk: { floor_tolerance_px } }),
      "walk.floor_tolerance_px must be a finite number >= 0",
    );
  });

  it("rejects an inverted interval range", () => {
    expectIssue(
      avatarWith({ walk: { interval_min_ms: 200_000 } }),
      "walk.interval_min_ms must be <= walk.interval_max_ms",
    );
  });

  it("rejects an inverted distance range", () => {
    expectIssue(
      avatarWith({ walk: { distance_min_px: 700 } }),
      "walk.distance_min_px must be <= walk.distance_max_px",
    );
  });
});

describe("validateAvatar — perch_walk", () => {
  it("keeps every perch-walk key the file declares", () => {
    expect(
      validateAvatar(
        FILE,
        avatarWith({
          perch_walk: { dwell_min_ms: 10_000, distance_max_px: 240, level_tolerance_px: 0 },
        }),
      ).perch_walk,
    ).toEqual({
      dwell_min_ms: 10_000,
      dwell_max_ms: 120_000,
      distance_min_px: 80,
      distance_max_px: 240,
      edge_margin_frac: 0.2,
      level_tolerance_px: 0,
    });
  });

  it("rejects a non-object perch-walk block", () => {
    expectIssue(avatarWith({ perch_walk: "nope" }), "perch_walk must be an object");
  });

  it.each([
    ["dwell_min_ms", -1],
    ["dwell_max_ms", 1.5],
    ["distance_min_px", 0],
    ["distance_max_px", Number.POSITIVE_INFINITY],
    ["edge_margin_frac", -0.1],
    ["edge_margin_frac", 1.1],
    ["level_tolerance_px", -1],
    ["level_tolerance_px", "8"],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(avatarWith({ perch_walk: { [field]: value } }), `perch_walk.${field}`);
  });

  it("rejects inverted dwell and distance ranges", () => {
    expectIssue(
      avatarWith({ perch_walk: { dwell_min_ms: 130_000 } }),
      "perch_walk.dwell_min_ms must be <= perch_walk.dwell_max_ms",
    );
    expectIssue(
      avatarWith({ perch_walk: { distance_min_px: 500 } }),
      "perch_walk.distance_min_px must be <= perch_walk.distance_max_px",
    );
  });
});

describe("validateAvatar — fall", () => {
  it("keeps every fall key the file declares", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ fall: { gravity_px_s2: 1200, min_drop_frac: 0.5 } }),
    );

    expect(out.fall).toEqual({
      gravity_px_s2: 1200,
      max_speed_px_s: 1200,
      min_drop_frac: 0.5,
      cue_cooldown_ms: 60_000,
      land_room_frac: 0.5,
      step_off_probability: 0.1,
    });
  });

  it("rejects a non-object fall block", () => {
    expectIssue(avatarWith({ fall: "nope" }), "fall must be an object");
  });

  it.each([
    ["gravity_px_s2", 0],
    ["gravity_px_s2", -1],
    ["max_speed_px_s", "1800"],
    ["max_speed_px_s", Number.POSITIVE_INFINITY],
    ["land_room_frac", 0],
    ["land_room_frac", "0.5"],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ fall: { [field]: value } }),
      `fall.${field} must be a finite number > 0`,
    );
  });

  it.each([
    -0.1,
    1.5,
    "0.2",
    Number.NaN,
  ])("rejects a min_drop_frac outside [0, 1]: %s", (min_drop_frac) => {
    expectIssue(
      avatarWith({ fall: { min_drop_frac } }),
      "fall.min_drop_frac must be a finite number in [0, 1]",
    );
  });

  it("accepts the boundary fractions", () => {
    expect(
      validateAvatar(FILE, avatarWith({ fall: { min_drop_frac: 0 } })).fall.min_drop_frac,
    ).toBe(0);
    expect(
      validateAvatar(FILE, avatarWith({ fall: { min_drop_frac: 1 } })).fall.min_drop_frac,
    ).toBe(1);
  });

  it.each([-1, "60000", 1.5])("rejects an invalid cue_cooldown_ms: %s", (cue_cooldown_ms) => {
    expectIssue(
      avatarWith({ fall: { cue_cooldown_ms } }),
      "fall.cue_cooldown_ms must be an integer >= 0",
    );
  });

  it.each([
    -0.1,
    1.5,
    "0.1",
    Number.NaN,
  ])("rejects a step_off_probability outside [0, 1]: %s", (step_off_probability) => {
    expectIssue(
      avatarWith({ fall: { step_off_probability } }),
      "fall.step_off_probability must be a finite number in [0, 1]",
    );
  });

  it("accepts the boundary step-off probabilities", () => {
    expect(
      validateAvatar(FILE, avatarWith({ fall: { step_off_probability: 0 } })).fall
        .step_off_probability,
    ).toBe(0);
    expect(
      validateAvatar(FILE, avatarWith({ fall: { step_off_probability: 1 } })).fall
        .step_off_probability,
    ).toBe(1);
  });
});

describe("validateAvatar — descend", () => {
  it.each([1.5, -0.1])("rejects a chance outside [0, 1]: %s", (chance) => {
    expectIssue(
      avatarWith({ descend: { chance } }),
      "descend.chance must be a finite number in [0, 1]",
    );
  });

  it("accepts the boundary chances", () => {
    expect(validateAvatar(FILE, avatarWith({ descend: { chance: 0 } })).descend.chance).toBe(0);
    expect(validateAvatar(FILE, avatarWith({ descend: { chance: 1 } })).descend.chance).toBe(1);
  });
});

describe("validateAvatar — climb", () => {
  it("keeps every climb key the file declares", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ climb: { interval_min_ms: 30_000, hang_frac: 0.4 } }),
    );

    expect(out.climb).toEqual({
      interval_min_ms: 30_000,
      interval_max_ms: 180_000,
      perch_dwell_min_ms: 60_000,
      perch_dwell_max_ms: 120_000,
      max_height_frac: 4,
      hang_frac: 0.4,
      wall_offset_frac: 0.17,
      descent_wall_offset_frac: 0.3,
      ledge_walk_min_frac: 0.5,
      ledge_walk_max_frac: 1.5,
    });
  });

  it("rejects a non-object climb block", () => {
    expectIssue(avatarWith({ climb: "nope" }), "climb must be an object");
  });

  it.each([
    ["interval_min_ms", -1],
    ["interval_max_ms", "180000"],
    ["perch_dwell_min_ms", 1.5],
    ["perch_dwell_max_ms", Number.NaN],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ climb: { [field]: value } }),
      `climb.${field} must be an integer >= 0`,
    );
  });

  it.each([
    ["max_height_frac", 0],
    ["hang_frac", -0.1],
    ["wall_offset_frac", "0.15"],
    ["descent_wall_offset_frac", 0],
    ["ledge_walk_min_frac", 0],
    ["ledge_walk_max_frac", Number.POSITIVE_INFINITY],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ climb: { [field]: value } }),
      `climb.${field} must be a finite number > 0`,
    );
  });

  it("rejects an inverted interval range", () => {
    expectIssue(
      avatarWith({ climb: { interval_min_ms: 200_000 } }),
      "climb.interval_min_ms must be <= climb.interval_max_ms",
    );
  });

  it("rejects an inverted dwell range", () => {
    expectIssue(
      avatarWith({ climb: { perch_dwell_min_ms: 200_000 } }),
      "climb.perch_dwell_min_ms must be <= climb.perch_dwell_max_ms",
    );
  });

  it("rejects an inverted ledge-walk range", () => {
    expectIssue(
      avatarWith({ climb: { ledge_walk_min_frac: 2 } }),
      "climb.ledge_walk_min_frac must be <= climb.ledge_walk_max_frac",
    );
  });
});

describe("validateAvatar — jump", () => {
  it("keeps every jump key the file declares", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({ jump: { probability: 1, gap_max_width_frac: 2 } }),
    );

    expect(out.jump).toEqual({
      probability: 1,
      height_up_max_frac: 0.5,
      height_down_max_frac: 1,
      gap_max_width_frac: 2,
      apex_lift_frac: 0.15,
      takeoff_frac: 0.4,
      land_frac: 0.67,
      flight_timeout_ms: 4000,
    });
  });

  it.each([0, -1, "4000", 1.5])("rejects an invalid flight_timeout_ms: %s", (value) => {
    expectIssue(
      avatarWith({ jump: { flight_timeout_ms: value } }),
      "jump.flight_timeout_ms must be an integer > 0",
    );
  });

  it("rejects a non-object jump block", () => {
    expectIssue(avatarWith({ jump: "nope" }), "jump must be an object");
  });

  it.each([-0.1, 1.1, "0.3", Number.NaN])("rejects an invalid probability: %s", (probability) => {
    expectIssue(
      avatarWith({ jump: { probability } }),
      "jump.probability must be a finite number in [0, 1]",
    );
  });

  it.each([
    ["height_up_max_frac", 0],
    ["height_down_max_frac", -1],
    ["gap_max_width_frac", "1.5"],
    ["apex_lift_frac", Number.POSITIVE_INFINITY],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ jump: { [field]: value } }),
      `jump.${field} must be a finite number > 0`,
    );
  });

  it.each([
    ["takeoff_frac", -0.1],
    ["land_frac", 1.5],
  ])("rejects invalid %s: %s", (field, value) => {
    expectIssue(
      avatarWith({ jump: { [field]: value } }),
      `jump.${field} must be a finite number in [0, 1]`,
    );
  });

  it("rejects an airborne window that ends before it starts", () => {
    expectIssue(
      avatarWith({ jump: { takeoff_frac: 0.8 } }),
      "jump.takeoff_frac must be < jump.land_frac",
    );
  });
});

describe("validateAvatar — drag_hold_ms", () => {
  it("accepts a configured value", () => {
    const out = validateAvatar(FILE, avatarWith({ drag_hold_ms: 3000 }));
    expect(out.drag_hold_ms).toBe(3000);
  });

  it.each([0, -1, 1.5, "5000", Number.NaN])("rejects invalid drag_hold_ms: %s", (drag_hold_ms) => {
    expectIssue(avatarWith({ drag_hold_ms }), "drag_hold_ms must be an integer >= 1");
  });
});

describe("validateAvatar — gesture_cues", () => {
  const FULL = {
    drag_held: { label: "dragged around", context: "put me down" },
    window_sit: { label: "sat on window", context: "say something" },
    peek: { label: "peeking", context: "say something playful" },
    dropped: { label: "dropped from mid-air", context: "say something startled" },
  };

  it("keeps a cue's authored context", () => {
    const out = validateAvatar(
      FILE,
      avatarWith({
        gesture_cues: { drag_held: { label: "held too long", context: "put me down now" } },
      }),
    );
    expect(out.gesture_cues.drag_held).toEqual({
      label: "held too long",
      context: "put me down now",
    });
    expect(out.gesture_cues.window_sit.label).toBe("sat on window");
  });

  it("accepts a full gesture_cues block", () => {
    const out = validateAvatar(FILE, avatarWith({ gesture_cues: FULL }));
    expect(out.gesture_cues).toEqual(FULL);
  });

  it("rejects a non-object gesture_cues block", () => {
    expectIssue(avatarWith({ gesture_cues: "nope" }), "gesture_cues must be an object");
  });

  it("rejects an unknown gesture_cues key", () => {
    expectIssue(
      avatarWith({ gesture_cues: { tap_bored: { label: "a", context: "b" } } }),
      "gesture_cues.tap_bored is an unknown key",
    );
  });

  it("rejects a non-object cue entry", () => {
    expectIssue(
      avatarWith({ gesture_cues: { drag_held: "nope" } }),
      "gesture_cues.drag_held must be an object",
    );
  });

  it.each([
    ["label", ""],
    ["label", 1],
    ["context", ""],
    ["context", 1],
  ] as const)("rejects an empty or non-string gesture_cues.drag_held.%s", (field, value) => {
    expectIssue(
      avatarWith({ gesture_cues: { drag_held: { [field]: value } } }),
      `gesture_cues.drag_held.${field} must be a non-empty string`,
    );
  });
});

describe("validateAvatar — gaze", () => {
  it("rejects a non-object gaze", () => {
    expectIssue(avatarWith({ gaze: "nope" }), "gaze must be an object");
  });

  it("accepts deadDeg:0 (inclusive lower bound)", () => {
    const out = validateAvatar(FILE, avatarWith({ gaze: { deadDeg: 0 } }));
    expect(out.gaze?.deadDeg).toBe(0);
  });

  it("rejects headEngageDeg:0 (exclusive lower bound)", () => {
    expectIssue(
      avatarWith({ gaze: { headEngageDeg: 0 } }),
      "gaze.headEngageDeg must be a finite number in (0, 180]",
    );
  });

  it("rejects maxHeadYaw above 90", () => {
    expectIssue(avatarWith({ gaze: { maxHeadYaw: 91 } }), "gaze.maxHeadYaw must be");
  });

  it("rejects headNeckSplit outside [0, 1]", () => {
    expectIssue(
      avatarWith({ gaze: { headNeckSplit: 1.1 } }),
      "gaze.headNeckSplit must be a finite number in [0, 1]",
    );
  });

  it("accepts headNeckSplit:0 (inclusive lower bound)", () => {
    const out = validateAvatar(FILE, avatarWith({ gaze: { headNeckSplit: 0 } }));
    expect(out.gaze?.headNeckSplit).toBe(0);
  });

  it("rejects smooth above 1000", () => {
    expectIssue(avatarWith({ gaze: { smooth: 1001 } }), "gaze.smooth must be");
  });

  it("rejects a non-finite gaze value", () => {
    expectIssue(avatarWith({ gaze: { eyeMaxDeg: Number.NaN } }), "gaze.eyeMaxDeg must be");
  });
});

/** Valid vrm_url and an array-valued available, with at least one fault in every section. */
const BROKEN_EVERYWHERE = {
  vrm_url: "/vrms/x.vrm",
  available: [
    "not-an-object",
    { id: "bad id", label: "", url: "u", source: "cloud" },
    { id: "dup", label: "A", url: "u" },
    { id: "dup", label: "B", url: "u", source: "user" },
  ],
  framing: { margin: -1, fov: 180, upper_body: { from_frac: 0.9, to_frac: 0.5 } },
  hit_test: {
    hysteresis_margin_px: -1,
    poll_interval_ms: 0,
    debounce_samples: 1.5,
    alpha_threshold: 0,
  },
  tap: {
    spam_count: 1,
    spam_window_ms: 70000,
    region_radius_frac: 0,
    touch_cue_cooldown_ms: -1,
    touch_emotion_hold_ms: 0,
    pat_hold_ms: "x",
    region_motions: { head: "", extra: "m" },
    bored_cue: { label: "", context: "" },
    region_emotions: { foo: "x", head: "" },
    region_cues: { head: "str", chest: { label: 1 }, bar: {} },
  },
  peek: { side_out_frac: 0, side_in_frac: 3, inset_frac: 2, mirror_side: "up" },
  walk: {
    interval_min_ms: 5,
    interval_max_ms: 1,
    distance_min_px: 9,
    distance_max_px: 3,
    floor_tolerance_px: -1,
  },
  perch_walk: {
    dwell_min_ms: 10,
    dwell_max_ms: 5,
    distance_min_px: 9,
    distance_max_px: 3,
    edge_margin_frac: 2,
    level_tolerance_px: -1,
  },
  fall: {
    gravity_px_s2: 0,
    max_speed_px_s: -1,
    land_room_frac: "a",
    min_drop_frac: 2,
    cue_cooldown_ms: -1,
    step_off_probability: 2,
  },
  descend: { chance: 2, climb_down_chance: "x" },
  climb: {
    interval_min_ms: 9,
    interval_max_ms: 1,
    perch_dwell_min_ms: 9,
    perch_dwell_max_ms: 1,
    max_height_frac: 0,
    hang_frac: 1,
    wall_offset_frac: 1,
    descent_wall_offset_frac: 1,
    ledge_walk_min_frac: 2,
    ledge_walk_max_frac: 1,
  },
  jump: {
    probability: 2,
    takeoff_frac: 0.8,
    land_frac: 0.5,
    height_up_max_frac: 0,
    height_down_max_frac: 1,
    gap_max_width_frac: 1,
    apex_lift_frac: 1,
    flight_timeout_ms: 0,
  },
  drag_hold_ms: 0,
  gesture_cues: {
    drag_held: { label: "" },
    window_sit: "x",
    peek: { label: "p", context: "" },
    extra: {},
  },
  gaze: { deadDeg: -1, headEngageDeg: 0, sensitivity: 181, maxHeadYaw: "x" },
};

describe("validateAvatar — characterization", () => {
  it("reports every section's issues in section order", () => {
    let issues: string[] = [];
    try {
      validateAvatar(FILE, BROKEN_EVERYWHERE);
    } catch (e) {
      issues = (e as ConfigError).issues;
    }
    expect(issues).toEqual([
      "available[0]: entry is not an object",
      'available[1].label must be a non-empty string (got: "")',
      'available[1].id must contain only [A-Za-z0-9._-] (got: "bad id")',
      'available[1].source must be one of bundled|file|user (got: "cloud")',
      'available[2].id is a duplicate (got: "dup")',
      "framing.margin must be a finite number >= 0 (got: -1)",
      "framing.fov must be a finite number in (0, 180) (got: 180)",
      "framing.upper_body.from_frac must be < framing.upper_body.to_frac (got: 0.9 >= 0.5)",
      "hit_test.hysteresis_margin_px must be a finite number >= 0 (got: -1)",
      "hit_test.poll_interval_ms must be a finite number > 0 (got: 0)",
      "hit_test.debounce_samples must be an integer >= 1 (got: 1.5)",
      "hit_test.alpha_threshold must be a finite number in (0, 1] (got: 0)",
      "tap.spam_count must be an integer >= 2 (got: 1)",
      "tap.spam_window_ms must be an integer in [1, 60000] (got: 70000)",
      "tap.region_radius_frac must be a finite number in (0, 1] (got: 0)",
      "tap.touch_cue_cooldown_ms must be an integer >= 0 (got: -1)",
      "tap.touch_emotion_hold_ms must be an integer >= 1 (got: 0)",
      'tap.pat_hold_ms must be an integer >= 1 (got: "x")',
      "tap.region_motions.extra is an unknown key",
      'tap.region_motions.head must be a non-empty string (got: "")',
      "tap.region_motions.chest must be a non-empty string (got: undefined)",
      "tap.region_motions.hips must be a non-empty string (got: undefined)",
      'tap.bored_cue.label must be a non-empty string (got: "")',
      'tap.bored_cue.context must be a non-empty string (got: "")',
      "tap.region_emotions.foo is an unknown key",
      'tap.region_emotions.head must be a non-empty string (got: "")',
      "tap.region_cues.bar is an unknown key",
      'tap.region_cues.head must be an object (got: "str")',
      "tap.region_cues.chest.label must be a non-empty string (got: 1)",
      "peek.side_out_frac must be a finite number in (0, 2] (got: 0)",
      "peek.side_in_frac must be a finite number in (0, 2] (got: 3)",
      "peek.inset_frac must be a finite number in [0, 1] (got: 2)",
      'peek.mirror_side must be one of left|right|none (got: "up")',
      "walk.floor_tolerance_px must be a finite number >= 0 (got: -1)",
      "walk.interval_min_ms must be <= walk.interval_max_ms (got: 5 > 1)",
      "walk.distance_min_px must be <= walk.distance_max_px (got: 9 > 3)",
      "perch_walk.edge_margin_frac must be a finite number in [0, 1] (got: 2)",
      "perch_walk.level_tolerance_px must be a finite number >= 0 (got: -1)",
      "perch_walk.dwell_min_ms must be <= perch_walk.dwell_max_ms (got: 10 > 5)",
      "perch_walk.distance_min_px must be <= perch_walk.distance_max_px (got: 9 > 3)",
      "fall.gravity_px_s2 must be a finite number > 0 (got: 0)",
      "fall.max_speed_px_s must be a finite number > 0 (got: -1)",
      'fall.land_room_frac must be a finite number > 0 (got: "a")',
      "fall.min_drop_frac must be a finite number in [0, 1] (got: 2)",
      "fall.cue_cooldown_ms must be an integer >= 0 (got: -1)",
      "fall.step_off_probability must be a finite number in [0, 1] (got: 2)",
      "descend.chance must be a finite number in [0, 1] (got: 2)",
      'descend.climb_down_chance must be a finite number in [0, 1] (got: "x")',
      "climb.max_height_frac must be a finite number > 0 (got: 0)",
      "climb.interval_min_ms must be <= climb.interval_max_ms (got: 9 > 1)",
      "climb.perch_dwell_min_ms must be <= climb.perch_dwell_max_ms (got: 9 > 1)",
      "climb.ledge_walk_min_frac must be <= climb.ledge_walk_max_frac (got: 2 > 1)",
      "jump.probability must be a finite number in [0, 1] (got: 2)",
      "jump.height_up_max_frac must be a finite number > 0 (got: 0)",
      "jump.flight_timeout_ms must be an integer > 0 (got: 0)",
      "jump.takeoff_frac must be < jump.land_frac (got: 0.8 >= 0.5)",
      "drag_hold_ms must be an integer >= 1 (got: 0)",
      "gesture_cues.extra is an unknown key",
      'gesture_cues.drag_held.label must be a non-empty string (got: "")',
      'gesture_cues.window_sit must be an object (got: "x")',
      'gesture_cues.peek.context must be a non-empty string (got: "")',
      "gesture_cues.dropped must be an object (got: undefined)",
      "gaze.deadDeg must be a finite number in [0, 180] (got: -1)",
      "gaze.headEngageDeg must be a finite number in (0, 180] (got: 0)",
      "gaze.disengageDeg must be a finite number in (0, 180] (got: undefined)",
      "gaze.sensitivity must be a finite number in (0, 180] (got: 181)",
      'gaze.maxHeadYaw must be a finite number in (0, 90] (got: "x")',
      "gaze.maxHeadPitch must be a finite number in (0, 90] (got: undefined)",
      "gaze.eyeMaxDeg must be a finite number in (0, 90] (got: undefined)",
      "gaze.headNeckSplit must be a finite number in [0, 1] (got: undefined)",
      "gaze.smooth must be a finite number in (0, 1000] (got: undefined)",
    ]);
  });

  it("returns the shipped configs/avatar.json in full", () => {
    const shipped = JSON.parse(
      readFileSync(resolve(__dirname, "../../../configs/avatar.json"), "utf8"),
    );
    expect(validateAvatar(FILE, shipped)).toEqual({
      vrm_url: "/vrms/Sendagaya_Shino.vrm",
      framing: {
        margin: 0.1,
        fov: 30,
        upper_body: {
          from_frac: 0.4,
          to_frac: 1,
        },
      },
      hit_test: {
        hysteresis_margin_px: 8,
        poll_interval_ms: 33,
        debounce_samples: 2,
        alpha_threshold: 0.1,
      },
      tap: {
        spam_count: 4,
        spam_window_ms: 3000,
        region_radius_frac: 0.18,
        touch_cue_cooldown_ms: 60000,
        touch_emotion_hold_ms: 4000,
        pat_hold_ms: 300,
        region_motions: {
          head: "head_pat",
          chest: "embarrassed",
          hips: "embarrassed",
        },
        bored_cue: {
          label: "bored poking",
        },
        region_emotions: {
          head: "relaxed",
          chest: "embarrassed",
          hips: "embarrassed",
        },
        region_cues: {
          head: {
            label: "head patted",
          },
          chest: {
            label: "chest poked",
          },
          hips: {
            label: "butt poked",
          },
        },
      },
      peek: {
        side_out_frac: 0.28,
        side_in_frac: 0.23,
        inset_frac: 0.12,
        mirror_side: "right",
      },
      walk: {
        interval_min_ms: 30000,
        interval_max_ms: 60000,
        distance_min_px: 200,
        distance_max_px: 600,
        floor_tolerance_px: 24,
      },
      perch_walk: {
        dwell_min_ms: 45000,
        dwell_max_ms: 120000,
        distance_min_px: 80,
        distance_max_px: 400,
        edge_margin_frac: 0.2,
        level_tolerance_px: 8,
      },
      fall: {
        gravity_px_s2: 1600,
        max_speed_px_s: 1200,
        land_room_frac: 0.5,
        min_drop_frac: 0.2,
        cue_cooldown_ms: 60000,
        step_off_probability: 0.1,
      },
      descend: {
        chance: 0.5,
        climb_down_chance: 0.5,
      },
      climb: {
        interval_min_ms: 90000,
        interval_max_ms: 180000,
        perch_dwell_min_ms: 60000,
        perch_dwell_max_ms: 120000,
        max_height_frac: 4,
        hang_frac: 0.3,
        wall_offset_frac: 0.17,
        descent_wall_offset_frac: 0.3,
        ledge_walk_min_frac: 0.5,
        ledge_walk_max_frac: 1.5,
      },
      jump: {
        probability: 0.3,
        takeoff_frac: 0.4,
        land_frac: 0.67,
        height_up_max_frac: 0.5,
        height_down_max_frac: 1,
        gap_max_width_frac: 1.5,
        apex_lift_frac: 0.15,
        flight_timeout_ms: 4000,
      },
      drag_hold_ms: 5000,
      gesture_cues: {
        drag_held: {
          label: "dragged around",
        },
        window_sit: {
          label: "sat on window",
        },
        peek: {
          label: "peeking",
        },
        dropped: {
          label: "dropped from mid-air",
        },
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
      available: [
        {
          id: "sendagaya_shino",
          label: "Sendagaya Shino",
          url: "/vrms/Sendagaya_Shino.vrm",
          source: "bundled",
        },
      ],
    });
  });
});
