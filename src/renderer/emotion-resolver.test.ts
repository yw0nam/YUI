/**
 * emotion-resolver.test.ts
 *
 * Encodes the contract that emotion-resolver.ts implements.
 *
 * Conventions:
 *  - Small synthetic registries for cycle-guard / edge cases.
 *  - Real configs/emotion_registry.json (loaded with readFileSync) for
 *    fallback chain / existence-aware resolution tests.
 *  - `hasExpression` / `warn` are injected for determinism.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { EmotionId, EmotionRegistry } from "../contract";
import { createEmotionResolver } from "./emotion-resolver";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load the real emotion_registry.json from the project root (vitest cwd = project root). */
const realRegistry: EmotionRegistry = JSON.parse(
  readFileSync(resolve(process.cwd(), "configs/emotion_registry.json"), "utf-8"),
);

// ─────────────────────────────────────────────────────────────────────────────
// §1  resolve() — defaults + clamp
// ─────────────────────────────────────────────────────────────────────────────

describe("resolve() — defaults and intensity clamp", () => {
  it("resolve({id:'happy'}) with hasExpression:()=>true → {id:'happy', vrm_expression:'happy', intensity:1, transition_ms:250}", () => {
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
    });
    const result = resolver.resolve({ id: "happy" });
    expect(result.id).toBe("happy");
    expect(result.vrm_expression).toBe("happy");
    expect(result.intensity).toBe(1);
    expect(result.transition_ms).toBe(250);
  });

  it("intensity:0.5 and transition_ms:400 in signal are preserved", () => {
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
    });
    const result = resolver.resolve({ id: "happy", intensity: 0.5, transition_ms: 400 });
    expect(result.intensity).toBe(0.5);
    expect(result.transition_ms).toBe(400);
  });

  it("intensity:1.5 → clamped to 1 AND warn called once", () => {
    const warn = vi.fn();
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
      warn,
    });
    const result = resolver.resolve({ id: "happy", intensity: 1.5 });
    expect(result.intensity).toBe(1);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("intensity:-0.2 → clamped to 0 AND warn called once", () => {
    const warn = vi.fn();
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
      warn,
    });
    const result = resolver.resolve({ id: "happy", intensity: -0.2 });
    expect(result.intensity).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
  });

  it("transition_ms omitted → default 250", () => {
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
    });
    const result = resolver.resolve({ id: "happy" });
    expect(result.transition_ms).toBe(250);
  });

  it("transition_ms:0 is valid and stays 0", () => {
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
    });
    const result = resolver.resolve({ id: "happy", transition_ms: 0 });
    expect(result.transition_ms).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  fallback chain — existence-aware (core logic)
// ─────────────────────────────────────────────────────────────────────────────

describe("fallback chain — existence-aware resolution", () => {
  it("embarrassed with hasExpression:k=>k!=='ex_blush' → vrm_expression:'surprised' (one hop: ex_blush absent → surprised present)", () => {
    // embarrassed: vrm_expression="ex_blush", fallback="surprised"
    // surprised entry: vrm_expression="surprised", fallback="neutral"
    // ex_blush absent → follow fallback to "surprised" entry → "surprised" present → use "surprised"
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: (k) => k !== "ex_blush",
    });
    const result = resolver.resolve({ id: "embarrassed" });
    expect(result.vrm_expression).toBe("surprised");
  });

  it("embarrassed with hasExpression:k=>k==='neutral' → vrm_expression:'neutral' (full walk ex_blush→surprised→neutral)", () => {
    // ex_blush absent → follow "surprised" entry → "surprised" absent → follow "neutral" entry → "neutral" present
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: (k) => k === "neutral",
    });
    const result = resolver.resolve({ id: "embarrassed" });
    expect(result.vrm_expression).toBe("neutral");
  });

  it("thinking with hasExpression:k=>k==='relaxed' → vrm_expression:'relaxed' (ex_thinking absent → relaxed)", () => {
    // thinking: vrm_expression="ex_thinking", fallback="relaxed"
    // relaxed entry: vrm_expression="relaxed", fallback="neutral"
    // ex_thinking absent → follow "relaxed" entry → "relaxed" present
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: (k) => k === "relaxed",
    });
    const result = resolver.resolve({ id: "thinking" });
    expect(result.vrm_expression).toBe("relaxed");
  });

  it("curious with hasExpression:k=>k==='surprised' → vrm_expression:'surprised'", () => {
    // curious: vrm_expression="ex_curious", fallback="surprised"
    // surprised entry: vrm_expression="surprised", fallback="neutral"
    // ex_curious absent → follow "surprised" entry → "surprised" present
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: (k) => k === "surprised",
    });
    const result = resolver.resolve({ id: "curious" });
    expect(result.vrm_expression).toBe("surprised");
  });

  it("happy with hasExpression:()=>true → vrm_expression:'happy' (own key present, no walk)", () => {
    // happy: vrm_expression="happy" → present immediately → no fallback walk
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => true,
    });
    const result = resolver.resolve({ id: "happy" });
    expect(result.vrm_expression).toBe("happy");
  });

  it("default predicate (no opts) behaves as ()=>true: resolve({id:'thinking'}) → ex_thinking (first key wins)", () => {
    // No hasExpression → default () => true → ex_thinking is present → use it directly
    const resolver = createEmotionResolver(realRegistry);
    const result = resolver.resolve({ id: "thinking" });
    expect(result.vrm_expression).toBe("ex_thinking");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  cycle guard + edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("cycle guard + edge cases", () => {
  it("synthetic cycle a→b→a with hasExpression:()=>false → terminates and returns vrm_expression:'neutral'", () => {
    // Synthetic registry with a cycle: a.fallback="b", b.fallback="a"
    // hasExpression: () => false → neither "x" nor "y" is present
    // Walk: a → try "x" (absent) → follow fallback "b" → try "y" (absent) →
    //       follow fallback "a" → already visited → terminate → return "neutral"
    const cyclicRegistry: EmotionRegistry = {
      a: { vrm_expression: "x", fallback: "b" },
      b: { vrm_expression: "y", fallback: "a" },
    } as unknown as EmotionRegistry;

    const resolver = createEmotionResolver(cyclicRegistry, {
      hasExpression: () => false,
    });

    // This call MUST return synchronously (no infinite loop) — if it hangs, test fails on timeout
    const result = resolver.resolve({ id: "a" as EmotionId });
    expect(result.vrm_expression).toBe("neutral");
  });

  it("unregistered id with hasExpression:()=>false → vrm_expression:'neutral' AND warn called once", () => {
    const warn = vi.fn();
    const resolver = createEmotionResolver(realRegistry, {
      hasExpression: () => false,
      warn,
    });
    const result = resolver.resolve({ id: "bogus" as EmotionId });
    expect(result.vrm_expression).toBe("neutral");
    expect(warn).toHaveBeenCalledOnce();
  });
});
