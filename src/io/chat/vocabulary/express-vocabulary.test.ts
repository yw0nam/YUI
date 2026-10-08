import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../../../config/load";
import { avatarFixture, guardrailsFixture } from "../../../config/load-test-helpers";
import { validateMotions } from "../../../config/validators/motions";
import type { MotionRegistry } from "../../../contract";
import { agentTriggerableMotionIds, deriveExpressVocabulary } from "./express-vocabulary";

describe("agentTriggerableMotionIds", () => {
  function motions(): MotionRegistry {
    return {
      idle: {
        vrma_path: "/motions/idle.vrma",
        kind: "ambient",
        loop: true,
        priority: 10,
        interrupt_policy: "ignore",
      },
      drag: {
        vrma_path: "/motions/drag.vrma",
        kind: "reactive",
        loop: false,
        priority: 50,
        interrupt_policy: "replace",
      },
      happy: {
        vrma_path: "/motions/happy.vrma",
        kind: "oneshot",
        loop: false,
        priority: 60,
        interrupt_policy: "replace",
      },
      sit: {
        vrma_path: "/motions/sit.vrma",
        kind: "oneshot",
        loop: false,
        priority: 60,
        interrupt_policy: "replace",
        broker_publish: false,
      },
      window_sit: {
        vrma_path: "/motions/sit_01.vrma",
        kind: "state",
        loop: true,
        priority: 55,
        interrupt_policy: "replace",
        broker_publish: false,
      },
    };
  }

  it("excludes reactive, ambient, and broker_publish:false motions", () => {
    const ids = agentTriggerableMotionIds(motions());
    expect(ids).not.toContain("drag");
    expect(ids).not.toContain("idle");
    expect(ids).not.toContain("sit");
    expect([...ids].sort()).toEqual(["happy"]);
  });

  it("excludes a kind:state motion solely via broker_publish:false (window_sit)", () => {
    const ids = agentTriggerableMotionIds(motions());
    expect(ids).not.toContain("window_sit");
  });

  it("returns an empty array for an empty registry", () => {
    expect(agentTriggerableMotionIds({})).toEqual([]);
  });

  it("keeps the three bed clips out of the agent-triggerable vocabulary", () => {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), "configs/motions.json"), "utf-8"));
    const motions = validateMotions("configs/motions.json", m);
    for (const id of ["bed_lie", "bed_sleep", "bed_wake"]) {
      expect(motions[id]?.broker_publish, id).toBe(false);
      expect(agentTriggerableMotionIds(motions), id).not.toContain(id);
    }
  });

  it("keeps walk out of the agent-triggerable vocabulary the broker publishes", () => {
    const m = JSON.parse(readFileSync(resolve(process.cwd(), "configs/motions.json"), "utf-8"));
    expect(agentTriggerableMotionIds(validateMotions("configs/motions.json", m))).not.toContain(
      "walk",
    );
  });
});

/** The selection is a required argument; most cases exercise it deselecting nothing. */
const NONE_DESELECTED = { expressMotions: { disabled: [] } };

describe("deriveExpressVocabulary", () => {
  function baseConfig(): AppConfig {
    return {
      endpoints: {
        chat_base_url: "http://localhost:8643",
        stt_base_url: "http://localhost:5517",
        tts_base_url: "http://localhost:8092",
      },
      avatar: avatarFixture(),
      emotionRegistry: {
        neutral: { vrm_expression: "neutral", fallback: "neutral" },
        happy: { vrm_expression: "happy", fallback: "neutral" },
      },
      motions: {
        idle: {
          vrma_path: "/motions/idle.vrma",
          kind: "ambient",
          loop: true,
          priority: 10,
          interrupt_policy: "ignore",
        },
        drag: {
          vrma_path: "/motions/drag.vrma",
          kind: "reactive",
          loop: false,
          priority: 50,
          interrupt_policy: "replace",
        },
        happy: {
          vrma_path: "/motions/happy.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
        },
        laugh: {
          vrma_path: "/motions/laugh.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
        },
        embarrassed: {
          vrma_path: "/motions/embarrassed.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
        },
        sit: {
          vrma_path: "/motions/sit.vrma",
          kind: "oneshot",
          loop: false,
          priority: 60,
          interrupt_policy: "replace",
          broker_publish: false,
        },
        window_sit: {
          vrma_path: "/motions/sit_01.vrma",
          kind: "state",
          loop: true,
          priority: 55,
          interrupt_policy: "replace",
          broker_publish: false,
        },
      },
      guardrails: {
        debounce_ms: {
          os_event_watcher: 0,
          user_input_source: 0,
          screen_watcher: 5000,
        },
        rate_limit: { window_ms: 0, tier2_max: 0, overall_max: 0, cooldown_ms: 0 },
        attachments: guardrailsFixture().attachments,
      },
      filler: {
        gap_ms: 0,
        gap_jitter_ms: 0,
        max_repeats: 3,
        gap_growth: 2,
        long_wait_ms: 40000,
        pools: {},
      },
      hotkeys: { summon_global: "" },
      screen: {
        prev_dwell_ms: 600000,
        settle_ms: 90000,
        long_session_ms: 2700000,
        min_gap_ms: 300000,
        quiet_after_turn_ms: 180000,
        recent_cap: 5,
      },
    };
  }

  it("derives emotion ids from registry keys", () => {
    const p = deriveExpressVocabulary(baseConfig(), null, NONE_DESELECTED);
    expect([...p.emotionIds].sort()).toEqual(["happy", "neutral"]);
  });

  it("excludes reactive, ambient, and broker_publish:false motions (drops drag/idle/sit, keeps happy/laugh/embarrassed)", () => {
    const p = deriveExpressVocabulary(baseConfig(), null, NONE_DESELECTED);
    expect(p.motionIds).not.toContain("drag");
    expect(p.motionIds).not.toContain("idle");
    expect(p.motionIds).not.toContain("sit");
    expect([...p.motionIds].sort()).toEqual(["embarrassed", "happy", "laugh"]);
  });

  it("excludes a kind:state motion solely via broker_publish:false (window_sit)", () => {
    const p = deriveExpressVocabulary(baseConfig(), null, NONE_DESELECTED);
    expect(p.motionIds).not.toContain("window_sit");
  });

  it("a table → enum + that table", () => {
    const table = { "😀": "happy", "😢": "sad" };
    const p = deriveExpressVocabulary(baseConfig(), table, NONE_DESELECTED);
    expect(p.emotionText).toEqual({ mode: "enum", table });
  });

  // A provider without a tag table derives this on every turn, so it is not a warning.
  it("a null table → free + null, without a warning", () => {
    const p = deriveExpressVocabulary(baseConfig(), null, NONE_DESELECTED);
    expect(p.emotionText).toEqual({ mode: "free", table: null });
  });

  // The user's expression-motion selection narrows the published vocabulary at this one derive
  // site, so both consumers — the broker publish and the CC generate_express schema — follow it.
  describe("expression-motion selection", () => {
    it("publishes the whole agent-triggerable set when nothing is deselected", () => {
      const p = deriveExpressVocabulary(baseConfig(), null, {
        expressMotions: { disabled: [] },
      });
      expect([...p.motionIds].sort()).toEqual(["embarrassed", "happy", "laugh"]);
    });

    it("drops a deselected motion from motionIds", () => {
      const p = deriveExpressVocabulary(baseConfig(), null, {
        expressMotions: { disabled: ["laugh"] },
      });
      expect(p.motionIds).toEqual(["happy", "embarrassed"]);
    });

    it("publishes an empty motion list when every motion is deselected", () => {
      const p = deriveExpressVocabulary(baseConfig(), null, {
        expressMotions: { disabled: ["happy", "laugh", "embarrassed"] },
      });
      expect(p.motionIds).toEqual([]);
    });

    it("keeps a catalog motion the selection has never heard of — additions arrive enabled", () => {
      const cfg = baseConfig();
      cfg.motions.wave = {
        vrma_path: "/motions/wave.vrma",
        kind: "oneshot",
        loop: false,
        priority: 60,
        interrupt_policy: "replace",
      };
      const p = deriveExpressVocabulary(cfg, null, { expressMotions: { disabled: ["laugh"] } });
      expect(p.motionIds).toContain("wave");
    });

    it("leaves emotion ids untouched — the selection curates motions only", () => {
      const p = deriveExpressVocabulary(baseConfig(), null, {
        expressMotions: { disabled: ["happy", "laugh", "embarrassed"] },
      });
      expect([...p.emotionIds].sort()).toEqual(["happy", "neutral"]);
    });
  });
});
