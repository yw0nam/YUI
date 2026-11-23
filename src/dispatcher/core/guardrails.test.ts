/**
 * guardrails.test.ts — debounce / rate-limit unit tests.
 *
 * Principle: time driven only by injected now() (no bare Date.now() dependency). Directly create
 * envelope composites from each source (os_event_watcher / user_input_source), locking
 * evaluation branches.
 *
 * Sections locked:
 *  - §6.2 Debounce: per-source window (os 5s / user 0).
 *  - §6.3 Rate-limit: tier2 6 rolling 60min (N pass, N+1 drop, no refund),
 *    overall 20 → cooldownActive() true then 5min hold → release.
 *  - §6.4 Evaluation order + dnd_override short-circuit (no counter increment).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { guardrailsFixture } from "../../config/load-test-helpers";
import { validateGuardrails } from "../../config/validators/guardrails";
import type { BusEnvelope } from "./event-bus";
import { createGuardrails, type Guardrails, type GuardrailsConfig } from "./guardrails";

const BASE_TS = 1_717_000_000_000;

/** SOT configs/guardrails.json mirror (§6 values). */
function config(): GuardrailsConfig {
  return {
    debounce_ms: {
      os_event_watcher: 5_000,
      user_input_source: 0,
      screen_watcher: 5000,
    },
    rate_limit: {
      window_ms: 3_600_000,
      tier2_max: 6,
      urgent_max: 120,
      overall_max: 20,
      cooldown_ms: 300_000,
      addressed_chain_max: 2,
    },
    attachments: guardrailsFixture().attachments,
  };
}

/** Injectable clock — test pushes .now to advance time. */
function clock(start = BASE_TS): {
  now: () => number;
  set: (t: number) => void;
  advance: (ms: number) => void;
} {
  let t = start;
  return {
    now: () => t,
    set: (v) => {
      t = v;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** Composite envelope. Caller overrides source/event_name/payload. */
function env(over: Partial<BusEnvelope> = {}): BusEnvelope {
  return {
    source: "os_event_watcher",
    event_name: "proactive.head_pat",
    ts: BASE_TS,
    ...over,
  };
}

// ── evaluate: dnd_override short-circuit (§6.4) ─────────────────────────────────

describe("guardrails — evaluate dnd_override short-circuit", () => {
  it("dnd_override passes without mutating any counter", () => {
    const g = createGuardrails(config());
    // fire many user-override turns — none increments rate counters.
    for (let i = 0; i < 50; i++) {
      const r = g.evaluate(
        env({ source: "user_input_source", event_name: "user.text_submitted", dnd_override: true }),
      );
      expect(r.pass).toBe(true);
    }
    // overall counter never moved → cooldown not entered.
    expect(g.cooldownActive()).toBe(false);
  });
});

// ── Debounce (§6.2) ──────────────────────────────────────────────────────────────

describe("guardrails — debounce per source (§6.2)", () => {
  it("os_event_watcher 5s window", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(
      g.evaluate(env({ source: "os_event_watcher", event_name: "user.drag_start" })).pass,
    ).toBe(true);
    c.advance(4_999);
    expect(
      g.evaluate(env({ source: "os_event_watcher", event_name: "user.drag_start" })).pass,
    ).toBe(false);
    c.advance(1);
    expect(
      g.evaluate(env({ source: "os_event_watcher", event_name: "user.drag_start" })).pass,
    ).toBe(true);
  });

  it("user_input_source 0 window — never debounce-dropped", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
      ).toBe(true);
    }
  });

  it("debounce state only mutates on a full pass (a dropped event does not move lastFire)", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(g.evaluate(env({ source: "os_event_watcher" })).pass).toBe(true); // lastFire = t0
    c.advance(2_000);
    expect(g.evaluate(env({ source: "os_event_watcher" })).pass).toBe(false); // dropped, lastFire stays t0
    c.advance(3_000); // t0 + 5_000 → window elapsed relative to t0, not the dropped attempt
    expect(g.evaluate(env({ source: "os_event_watcher" })).pass).toBe(true);
  });
});

// ── Rate-limit (§6.3) ────────────────────────────────────────────────────────────

describe("guardrails — tier2 rate-limit rolling 60min (§6.3)", () => {
  it("tier2 cap 6: first 6 pass, 7th drops", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      // distinct sources/time to avoid debounce — drive via user_input (debounce 0).
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
      ).toBe(true);
    }
    const r = g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }));
    expect(r.pass).toBe(false);
  });

  it("rolling window prunes: a tier2 slot frees once window_ms passes (no refund, time-based prune)", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
      ).toBe(true);
      c.advance(1);
    }
    // immediately full
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
    ).toBe(false);
    // advance past window relative to the first fire → one slot prunes, one more passes
    c.advance(3_600_000);
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
    ).toBe(true);
  });

  it("NO refund: a dropped (over-cap) attempt does not free a slot", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
      ).toBe(true);
    }
    // two over-cap attempts in the same instant — both drop, no slot is freed by the drops.
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
    ).toBe(false);
    expect(
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
    ).toBe(false);
  });
});

describe("guardrails — overall cap → cooldown (§6.3)", () => {
  it("overall 20 → 21st enters cooldown; cooldownActive() true for 5min then clears", () => {
    const c = clock();
    const cfg = config();
    // raise tier caps so the overall cap is the binding constraint.
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: c.now });
    for (let i = 0; i < 20; i++) {
      expect(
        g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass,
      ).toBe(true);
    }
    expect(g.cooldownActive()).toBe(false);

    const r = g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }));
    expect(r.pass).toBe(false);
    expect(g.cooldownActive()).toBe(true);

    // still active just before 5min
    c.advance(299_999);
    expect(g.cooldownActive()).toBe(true);
    // clears at 5min
    c.advance(1);
    expect(g.cooldownActive()).toBe(false);
  });

  it("during cooldown, further firings drop", () => {
    const c = clock();
    const cfg = config();
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: c.now });
    for (let i = 0; i < 20; i++) {
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }));
    }
    g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })); // enters cooldown
    const r = g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" }));
    expect(r.pass).toBe(false);
  });
});

// ── Shipped config (configs/guardrails.json) ───────────────────────────────────

describe("guardrails — shipped hourly limits", () => {
  function shipped(): GuardrailsConfig {
    const path = resolve(process.cwd(), "configs/guardrails.json");
    return validateGuardrails("configs/guardrails.json", JSON.parse(readFileSync(path, "utf-8")));
  }

  /** Fires `count` turns from `source`, one second apart from BASE_TS; returns the first drop's call number and the pass count. */
  function drive(
    g: Guardrails,
    c: ReturnType<typeof clock>,
    source: BusEnvelope["source"],
    event_name: string,
    count: number,
  ): { firstDrop: number; passed: number } {
    let firstDrop = 0;
    let passed = 0;
    for (let i = 0; i < count; i++) {
      c.set(BASE_TS + i * 1_000);
      if (g.evaluate(env({ source, event_name })).pass) passed++;
      else if (firstDrop === 0) firstDrop = i + 1;
    }
    return { firstDrop, passed };
  }

  /** Whether a non-urgent turn passes at `at`. */
  function turnAt(g: Guardrails, c: ReturnType<typeof clock>, at: number): boolean {
    c.set(at);
    return g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass;
  }

  it("drops the 25th non-urgent turn in an hour, and passes one as soon as the first slot frees", () => {
    const c = clock();
    const g = createGuardrails(shipped(), { now: c.now });
    expect(drive(g, c, "user_input_source", "user.text_submitted", 45)).toEqual({
      firstDrop: 25,
      passed: 24,
    });
    expect(turnAt(g, c, BASE_TS + 3_599_999)).toBe(false);
    expect(turnAt(g, c, BASE_TS + 3_600_000)).toBe(true);
  });

  it("lets tier2_max alone cap non-urgent turns: raised to 50, the 51st drops", () => {
    const c = clock();
    const cfg = shipped();
    cfg.rate_limit.tier2_max = 50;
    const g = createGuardrails(cfg, { now: c.now });
    expect(drive(g, c, "user_input_source", "user.text_submitted", 60)).toEqual({
      firstDrop: 51,
      passed: 50,
    });
    expect(turnAt(g, c, BASE_TS + 3_600_000)).toBe(true);
  });

  it("drops the 121st urgent turn, and the next non-urgent turn still passes", () => {
    const c = clock();
    const g = createGuardrails(shipped(), { now: c.now });
    expect(drive(g, c, "urgent_signal_source", "signals.urgent", 130)).toEqual({
      firstDrop: 121,
      passed: 120,
    });
    expect(turnAt(g, c, BASE_TS + 130_000)).toBe(true);
  });
});

// ── Eval ordering (§6.4) ─────────────────────────────────────────────────────────

describe("guardrails — eval ordering (§6.4)", () => {
  /** Drives the overall cap with a debounce-free source. */
  function overallDriver(g: Guardrails): () => boolean {
    return () =>
      g.evaluate(env({ source: "user_input_source", event_name: "user.text_submitted" })).pass;
  }

  /** Cooldown reached via the overall cap, with the tier cap raised out of the way. */
  function inCooldown(c: ReturnType<typeof clock>): { g: Guardrails; fire: () => boolean } {
    const cfg = config();
    cfg.rate_limit.tier2_max = 1000;
    const g = createGuardrails(cfg, { now: c.now });
    const fire = overallDriver(g);
    for (let i = 0; i < 20; i++) expect(fire()).toBe(true);
    expect(fire()).toBe(false);
    expect(g.cooldownActive()).toBe(true);
    return { g, fire };
  }

  it("cooldown precedes rate-limit: a firing during cooldown does not re-arm cooldownUntil", () => {
    const c = clock();
    const { g, fire } = inCooldown(c);

    c.advance(200_000);
    for (let i = 0; i < 5; i++) expect(fire()).toBe(false);

    // cooldown_ms is measured from the entry, so it releases on schedule.
    c.set(BASE_TS + 300_000);
    expect(g.cooldownActive()).toBe(false);
  });

  it("a cooldown drop consumes no tier or overall rate-limit slot", () => {
    const c = clock();
    const { fire } = inCooldown(c);

    c.advance(200_000);
    for (let i = 0; i < 5; i++) expect(fire()).toBe(false);

    // Past window_ms measured from the 20 passes, but not from the 5 cooldown attempts:
    // whatever the window still holds was put there by a pass.
    c.set(BASE_TS + 3_600_500);
    let passed = 0;
    for (let i = 0; i < 25; i++) {
      if (fire()) passed++;
    }
    expect(passed).toBe(20);
  });

  it("dnd_override precedes cooldown: a user-initiated turn passes during cooldown", () => {
    const c = clock();
    const { g } = inCooldown(c);

    c.advance(1_000);
    const r = g.evaluate(
      env({
        source: "user_input_source",
        event_name: "user.text_submitted",
        dnd_override: true,
      }),
    );
    expect(r.pass).toBe(true);
    expect(g.cooldownActive()).toBe(true);
  });
});

// ── interface surface ────────────────────────────────────────────────────────────

describe("guardrails — interface surface", () => {
  it("exposes evaluate / cooldownActive", () => {
    const g: Guardrails = createGuardrails(config());
    expect(typeof g.evaluate).toBe("function");
    expect(typeof g.cooldownActive).toBe("function");
  });

  it("has NO refund method (consume-on-fire, §6.3)", () => {
    const g = createGuardrails(config()) as unknown as Record<string, unknown>;
    expect(g.refund).toBeUndefined();
  });
});
