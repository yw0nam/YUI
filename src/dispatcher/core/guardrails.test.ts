/**
 * guardrails.test.ts — debounce / rate-limit unit tests.
 *
 * Principle: time driven only by injected now() (no bare Date.now() dependency). Directly create
 * envelope composites from each source (os_event_watcher / user_input_source), locking
 * evaluation branches.
 *
 * Sections locked:
 *  - §6.2 Debounce: per-source window (os 5s / user 0).
 *  - §6.3 Rate-limit: tier2 6 rolling 60min (N pass, N+1 drop, no refund).
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

/** One fire through the three calls: arrive, then spend a slot when one is free. */
function fire(g: Guardrails, e: BusEnvelope): boolean {
  if (!g.arrive(e).pass || !g.canSpend(e)) return false;
  g.spend(e);
  return true;
}

// ── dnd_override short-circuit (§6.4) ─────────────────────────────────

describe("guardrails — dnd_override short-circuit", () => {
  it("dnd_override passes without mutating any counter", () => {
    const g = createGuardrails(config());
    // fire many user-override turns — none increments rate counters.
    for (let i = 0; i < 50; i++) {
      const r = fire(
        g,
        env({ source: "user_input_source", event_name: "user.text_submitted", dnd_override: true }),
      );
      expect(r).toBe(true);
    }
    // the tier2 budget of 6 is untouched, so a non-override turn still passes.
    expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
      true,
    );
  });
});

// ── Debounce (§6.2) ──────────────────────────────────────────────────────────────

describe("guardrails — debounce per source (§6.2)", () => {
  it("arrive drops a second os_event_watcher fire inside the 5s window", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(g.arrive(env())).toEqual({ pass: true });
    c.advance(4_999);
    expect(g.arrive(env())).toEqual({ pass: false, reason: "guardrail_drop" });
    c.advance(1);
    expect(g.arrive(env())).toEqual({ pass: true });
  });

  it("user_input_source 0 window — never debounce-dropped", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 3; i++) {
      expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
        true,
      );
    }
  });

  it("debounce state only mutates on a full pass (a dropped event does not move lastFire)", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    expect(fire(g, env({ source: "os_event_watcher" }))).toBe(true); // lastFire = t0
    c.advance(2_000);
    expect(fire(g, env({ source: "os_event_watcher" }))).toBe(false); // dropped, lastFire stays t0
    c.advance(3_000); // t0 + 5_000 → window elapsed relative to t0, not the dropped attempt
    expect(fire(g, env({ source: "os_event_watcher" }))).toBe(true);
  });
});

// ── Rate-limit (§6.3) ────────────────────────────────────────────────────────────

describe("guardrails — canSpend and spend", () => {
  it("canSpend reads the window without spending, and spend takes one slot", () => {
    const g = createGuardrails(config());
    const cue = env({ source: "timer_scheduler", event_name: "proactive.stretch" });
    for (let i = 0; i < 20; i++) expect(g.canSpend(cue)).toBe(true);
    for (let i = 0; i < 6; i++) g.spend(cue);
    expect(g.canSpend(cue)).toBe(false);
    expect(g.canSpend(env({ source: "urgent_signal_source", event_name: "signals.urgent" }))).toBe(
      true,
    );
  });
});

describe("guardrails — tier2 rate-limit rolling 60min (§6.3)", () => {
  it("tier2 cap 6: first 6 pass, 7th drops", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      // distinct sources/time to avoid debounce — drive via user_input (debounce 0).
      expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
        true,
      );
    }
    const r = fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }));
    expect(r).toBe(false);
  });

  it("rolling window prunes: a tier2 slot frees once window_ms passes (no refund, time-based prune)", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
        true,
      );
      c.advance(1);
    }
    // immediately full
    expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
      false,
    );
    // advance past window relative to the first fire → one slot prunes, one more passes
    c.advance(3_600_000);
    expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
      true,
    );
  });

  it("NO refund: a dropped (over-cap) attempt does not free a slot", () => {
    const c = clock();
    const g = createGuardrails(config(), { now: c.now });
    for (let i = 0; i < 6; i++) {
      expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
        true,
      );
    }
    // two over-cap attempts in the same instant — both drop, no slot is freed by the drops.
    expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
      false,
    );
    expect(fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }))).toBe(
      false,
    );
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
      if (fire(g, env({ source, event_name }))) passed++;
      else if (firstDrop === 0) firstDrop = i + 1;
    }
    return { firstDrop, passed };
  }

  /** Whether a non-urgent turn passes at `at`. */
  function turnAt(g: Guardrails, c: ReturnType<typeof clock>, at: number): boolean {
    c.set(at);
    return fire(g, env({ source: "user_input_source", event_name: "user.text_submitted" }));
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

  it("passes 120 urgent turns while the speaking-up limit is full, and they take no tier2 slot", () => {
    const c = clock();
    const g = createGuardrails(shipped(), { now: c.now });
    for (let i = 0; i < 24; i++) expect(turnAt(g, c, BASE_TS)).toBe(true);
    expect(turnAt(g, c, BASE_TS)).toBe(false);
    expect(drive(g, c, "urgent_signal_source", "signals.urgent", 130)).toEqual({
      firstDrop: 121,
      passed: 120,
    });
    // The 24 slots free at window_ms; an urgent turn that took a slot would still hold one.
    expect(turnAt(g, c, BASE_TS + 3_600_000)).toBe(true);
  });
});

// ── interface surface ────────────────────────────────────────────────────────────

describe("guardrails — interface surface", () => {
  it("has NO refund method (consume-on-fire, §6.3)", () => {
    const g = createGuardrails(config()) as unknown as Record<string, unknown>;
    expect(g.refund).toBeUndefined();
  });
});
