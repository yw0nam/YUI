/**
 * Tier 1 ambient engine — local liveliness such as blink / idle sway / breath / look-around.
 *
 * Always on, **backend-independent** (no network). Via the renderer.onTick(rAF) hook, every frame
 * it writes bone (head/spine/chest) rotations + the blink expression just before vrm.update.
 * Ambient "owns" these channels (head/spine/chest rotation, blink) — it overwrites them with
 * absolute values every frame. While backend motion plays, the renderer takes over weight blending
 * (idle_sway weight 0.3→0.1 during motion playback).
 *
 * Cue table:
 *  - blink         : random 3~6s, 150ms pulse
 *  - idle_sway     : always, head/spine multi-frequency sine
 *  - breath        : 4s period, chest/spine sine
 *  - look_around   : random 30~120s, head gaze target shift (damped)
 *  - tap_react     : one head bob (nod) ~220ms on user.tap
 *  - idle_returned : one idle.returned, slight upward gaze ~900ms
 *
 * Pure cue math lives in ./cues.ts. Here we only handle timers, state, and VRM writes.
 */

import type { VRM } from "@pixiv/three-vrm";
import type { Object3D } from "three";
import type { Renderer, TickContext } from "../renderer";
import * as cues from "./cues";

export type AmbientCue =
  | "blink"
  | "idle_sway"
  | "breath"
  | "look_around"
  | "tap_react"
  | "idle_returned";

export interface Tier1Engine {
  /** Register the renderer.onTick hook + start periodic cues. */
  start(): void;
  /** Trigger a one-shot cue (tap_react / idle_returned, etc. routed from dispatcher tier1). */
  trigger(cue: AmbientCue): void;
  /** Unregister the hook + stop. */
  stop(): void;
}

// ── Amplitude (radians) — all subtle. It should feel "alive", not like "dancing". ──
const SWAY = {
  headYaw: 0.05,
  headPitch: 0.035,
  headRoll: 0.03,
  spinePitch: 0.02,
} as const;
const BREATH_AMP = 0.022; // chest sine
const LOOK_LAMBDA = 1.8; // look target damping speed
const TAP_BOB_AMP = 0.13; // tap nod (downward, pitch+)
const IDLE_RETURN_AMP = -0.09; // slight upward on idle return (pitch-)

/** Capabilities resolved once per VRM (which bones/expressions exist). Re-resolved on hot-swap. */
interface Caps {
  head: Object3D | null;
  spine: Object3D | null;
  chest: Object3D | null;
  /** Blink expression names to use (single 'blink', or blinkLeft/Right). */
  blinkNames: string[];
}

interface OneShot {
  kind: "tap" | "idle_returned";
  /** Fixed within a tick. -1 = not yet started (fixed to the next tick's tMs). */
  startMs: number;
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

export function createTier1Engine(renderer: Renderer): Tier1Engine {
  let unsub: (() => void) | null = null;
  let started = false;

  // Per-VRM cache
  let capsVrm: VRM | null = null;
  let caps: Caps | null = null;

  // blink state (in ms, ctx.elapsed*1000)
  let nextBlinkAtMs = cues.nextBlinkDelay();
  let blinkStartMs: number | null = null;

  // look_around state
  let nextLookAtMs = cues.nextLookDelay();
  let lookTargetYaw = 0;
  let lookTargetPitch = 0;
  let lookYaw = 0;
  let lookPitch = 0;

  // one-shot cues
  const oneShots: OneShot[] = [];

  // reduced-motion (reflected live)
  let reduce = prefersReducedMotion();
  let mql: MediaQueryList | null = null;
  const onReduceChange = (e: MediaQueryListEvent): void => {
    reduce = e.matches;
  };

  function resolveCaps(vrm: VRM): Caps {
    const h = vrm.humanoid;
    const head = h?.getNormalizedBoneNode("head") ?? null;
    // Some models lack chest, so fall back upperChest→chest.
    const chest =
      h?.getNormalizedBoneNode("upperChest") ?? h?.getNormalizedBoneNode("chest") ?? null;
    const spine = h?.getNormalizedBoneNode("spine") ?? null;

    const em = vrm.expressionManager;
    let blinkNames: string[] = [];
    if (em) {
      if (em.getExpression("blink")) {
        blinkNames = ["blink"];
      } else {
        const pair: string[] = [];
        if (em.getExpression("blinkLeft")) pair.push("blinkLeft");
        if (em.getExpression("blinkRight")) pair.push("blinkRight");
        blinkNames = pair;
      }
    }
    return { head, spine, chest, blinkNames };
  }

  function tick(ctx: TickContext): void {
    const { vrm, dt, elapsed } = ctx;
    const tMs = elapsed * 1000;

    // Hot-swap handling: re-resolve capabilities when vrm changes.
    if (vrm !== capsVrm) {
      capsVrm = vrm;
      caps = resolveCaps(vrm);
    }
    const c = caps!;

    // ── blink (kept even under reduced-motion — blinking is not vestibular stimulation) ──
    if (blinkStartMs === null && tMs >= nextBlinkAtMs) {
      blinkStartMs = tMs;
    }
    let blinkW = 0;
    if (blinkStartMs !== null) {
      const e = tMs - blinkStartMs;
      blinkW = cues.blinkEnvelope(e);
      if (e >= cues.BLINK_DURATION_MS) {
        blinkStartMs = null;
        nextBlinkAtMs = tMs + cues.nextBlinkDelay();
      }
    }
    if (vrm.expressionManager && c.blinkNames.length > 0) {
      for (const name of c.blinkNames) {
        vrm.expressionManager.setValue(name, blinkW);
      }
    }

    // reduced-motion: keep only blink and pin the pose to rest.
    if (reduce) {
      if (c.head) c.head.rotation.set(0, 0, 0);
      if (c.spine) c.spine.rotation.x = 0;
      if (c.chest) c.chest.rotation.x = 0;
      return;
    }

    // ── idle_sway ──
    const sway = cues.swayOffsets(elapsed);

    // ── breath ──
    const breath = cues.breathOffset(elapsed) * BREATH_AMP;

    // ── look_around ── (new target when the period is reached, damped every frame)
    if (tMs >= nextLookAtMs) {
      const t = cues.nextLookTarget();
      lookTargetYaw = t.yaw;
      lookTargetPitch = t.pitch;
      nextLookAtMs = tMs + cues.nextLookDelay();
    }
    lookYaw = cues.damp(lookYaw, lookTargetYaw, LOOK_LAMBDA, dt);
    lookPitch = cues.damp(lookPitch, lookTargetPitch, LOOK_LAMBDA, dt);

    // ── Compose one-shot cues + drop expired ones ──
    let bobPitch = 0;
    for (let i = oneShots.length - 1; i >= 0; i--) {
      const os = oneShots[i];
      if (os.startMs < 0) os.startMs = tMs; // fix the start time on the first tick
      const e = tMs - os.startMs;
      if (os.kind === "tap") {
        bobPitch += TAP_BOB_AMP * cues.bobEnvelope(e, cues.TAP_BOB_MS);
        if (e >= cues.TAP_BOB_MS) oneShots.splice(i, 1);
      } else {
        bobPitch += IDLE_RETURN_AMP * cues.bobEnvelope(e, cues.IDLE_RETURNED_MS);
        if (e >= cues.IDLE_RETURNED_MS) oneShots.splice(i, 1);
      }
    }

    // ── After composing, write absolute values (ambient owns these channels) ──
    if (c.head) {
      c.head.rotation.set(
        sway.headPitch * SWAY.headPitch + lookPitch + bobPitch, // x = pitch
        sway.headYaw * SWAY.headYaw + lookYaw, // y = yaw
        sway.headRoll * SWAY.headRoll, // z = roll
      );
    }
    // Distribute breath/sway across spine and chest (chest breathes more).
    if (c.spine) c.spine.rotation.x = sway.spinePitch * SWAY.spinePitch + breath * 0.4;
    if (c.chest) c.chest.rotation.x = breath * 0.6;
  }

  return {
    start() {
      if (started) return;
      started = true;
      reduce = prefersReducedMotion();
      try {
        if (typeof matchMedia === "function") {
          mql = matchMedia("(prefers-reduced-motion: reduce)");
          mql.addEventListener("change", onReduceChange);
        }
      } catch {
        /* matchMedia unavailable (tests, etc.) — ignore */
      }
      unsub = renderer.onTick(tick);
    },
    trigger(cue) {
      // Queue one-shots only (periodic cues are automatic). startMs is fixed on the next tick (-1 sentinel).
      if (cue === "tap_react") oneShots.push({ kind: "tap", startMs: -1 });
      else if (cue === "idle_returned") oneShots.push({ kind: "idle_returned", startMs: -1 });
      // blink/idle_sway/breath/look_around are handled by the periodic engine — no-op.
    },
    stop() {
      started = false;
      if (unsub) {
        unsub();
        unsub = null;
      }
      if (mql) {
        mql.removeEventListener("change", onReduceChange);
        mql = null;
      }
      oneShots.length = 0;
    },
  };
}
