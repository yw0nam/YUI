import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAvatar } from "./validators/avatar";
import { validateEndpoints } from "./validators/endpoints";
import { validateGuardrails } from "./validators/guardrails";
import { validateHotkeys } from "./validators/hotkeys";
import { validateMotions } from "./validators/motions";
import { validateScreen } from "./validators/screen";

const read = (rel: string): any => JSON.parse(readFileSync(resolve(process.cwd(), rel), "utf-8"));

const SHIPPED: Array<[string, (file: string, raw: unknown) => unknown]> = [
  ["configs/endpoints.json", validateEndpoints],
  ["configs/avatar.json", validateAvatar],
  ["configs/guardrails.json", validateGuardrails],
  ["configs/screen.json", validateScreen],
  ["configs/hotkeys.json", validateHotkeys],
  ["configs/motions.json", validateMotions],
];

it.each(SHIPPED)("passes the shipped %s through its validator", (file, validate) => {
  expect(() => validate(file, read(file))).not.toThrow();
});

describe("configs/endpoints.json", () => {
  const ep = read("configs/endpoints.json");

  it.each([
    "chat_base_url",
    "stt_base_url",
    "tts_base_url",
    "broker_base_url",
    "chat_model",
    "tts_speaker",
  ])("ships no %s, which stays unset until the user sets one", (key) => {
    expect(ep).not.toHaveProperty(key);
  });

  it("names generate_express and its three channels in the chat_instructions nudge", () => {
    for (const name of ["generate_express", "emotion_id", "motion_id", "emotion_text"]) {
      expect(ep.chat_instructions, name).toContain(name);
    }
  });

  it("keeps chat_instructions provider-neutral: no preferred caption language", () => {
    expect(ep.chat_instructions).not.toMatch(/japanese/i);
  });
});

describe("configs/avatar.json", () => {
  const a = read("configs/avatar.json");
  const m = read("configs/motions.json");
  const emotions = read("configs/emotion_registry.json");

  it("points the default vrm_url at a VRM shipped under resources/", () => {
    expect(a.vrm_url).toMatch(/^\/vrms\/.+\.vrm$/);
    expect(existsSync(resolve(process.cwd(), "resources", a.vrm_url.replace(/^\//, "")))).toBe(
      true,
    );
  });

  it("offers the default vrm_url in the available[] manifest", () => {
    expect(a.available.map((o: { url: string }) => o.url)).toContain(a.vrm_url);
  });

  it("names only registered motions and emotions for the tap regions", () => {
    for (const [region, id] of Object.entries(a.tap.region_motions)) {
      expect(m, `region_motions.${region}`).toHaveProperty([id as string]);
    }
    for (const [region, id] of Object.entries(a.tap.region_emotions ?? {})) {
      expect(emotions, `region_emotions.${region}`).toHaveProperty([id as string]);
    }
  });

  it("holds the press-and-hold head pat on a looping motion", () => {
    expect(m[a.tap.region_motions.head].loop).toBe(true);
  });

  it("declares no gaze key the validator does not read", () => {
    expect(Object.keys(a.gaze).sort()).toEqual([
      "deadDeg",
      "disengageDeg",
      "eyeMaxDeg",
      "headEngageDeg",
      "headNeckSplit",
      "maxHeadPitch",
      "maxHeadYaw",
      "sensitivity",
      "smooth",
    ]);
  });

  it("ships built-in touch/gesture cues as label-only (context is persona judgment, not client data)", () => {
    const builtIn: Array<[string, object]> = [
      ...Object.entries(a.tap.region_cues ?? {}).map(
        ([region, cue]) => [`tap.region_cues.${region}`, cue] as [string, object],
      ),
      ["tap.bored_cue", a.tap.bored_cue],
      ...Object.entries(a.gesture_cues).map(
        ([key, cue]) => [`gesture_cues.${key}`, cue] as [string, object],
      ),
    ];
    for (const [path, cue] of builtIn) {
      expect(Object.keys(cue), path).toEqual(["label"]);
    }
  });
});

describe("configs/motions.json", () => {
  const m = read("configs/motions.json");

  // kind decides whether a finishing oneshot returns to the clip (ambient/state); loop decides
  // whether the player holds the clip until it clears it or waits for the clip to end itself.
  it.each([
    ["idle", "ambient", true],
    ["drag", "reactive", true],
    ["peek", "state", true],
    ["window_sit", "state", true],
    ["walk", "reactive", true],
    ["falling", "reactive", true],
    ["landing", "oneshot", false],
    ["climb_up", "reactive", true],
    ["climb_up_done", "oneshot", false],
    ["climb_down", "reactive", true],
    ["climb_down_landing", "oneshot", false],
    ["sit_down", "oneshot", false],
    ["stand_up", "oneshot", false],
    ["jump", "oneshot", false],
    ["thinking", "state", true],
    ["head_pat", "reactive", true],
    ["bed_lie", "oneshot", false],
    ["bed_sleep", "oneshot", true],
    ["bed_wake", "oneshot", false],
  ])("registers %s, a clip the client plays, as kind %s with loop %s", (id, kind, loop) => {
    expect(m[id], id).toBeDefined();
    expect(m[id].kind).toBe(kind);
    expect(m[id].loop).toBe(loop);
  });

  it.each([
    "calm",
    "dance",
    "embarrassed",
    "happy",
    "idle_lively",
    "laugh",
    "sheepish",
    "sulk",
  ])("registers the agent-selectable %s as a oneshot that ends by itself", (id) => {
    expect(m[id], id).toBeDefined();
    expect(m[id].kind).toBe("oneshot");
    expect(m[id].loop).toBe(false);
  });

  it("ships dance and idle_lively as variant pools", () => {
    for (const id of ["dance", "idle_lively"]) {
      expect(m[id].variants?.length, `${id}.variants`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps idle's baseline clip inside its own variant pool, so the selection cannot empty it", () => {
    expect(m.idle.variants).toContain(m.idle.vrma_path);
  });

  it.each([
    ["walk", "thinking", "a backend turn takes the clip mid-stroll"],
    ["falling", "drag", "a pickup takes the body mid-fall"],
    ["idle", "jump", "the jump outranks the idle the walk handed back"],
    ["jump", "drag", "a pickup ends the jump"],
  ])("ranks %s below %s so %s", (lower, higher) => {
    expect(m[lower].priority).toBeLessThan(m[higher].priority);
  });

  it("keeps thinking on the ignore policy, so a lower-ranked clip cannot take the TTFT filler", () => {
    expect(m.thinking.interrupt_policy).toBe("ignore");
  });

  it("locks the root vertically on the climb clips and the seat transitions alone", () => {
    const locked = Object.entries(m)
      .filter(([, e]: [string, any]) => e.root_lock_y === true)
      .map(([id]) => id);
    expect(locked.sort()).toEqual([
      "climb_down",
      "climb_down_landing",
      "climb_up",
      "climb_up_done",
      "sit_down",
      "stand_up",
    ]);
  });
});
