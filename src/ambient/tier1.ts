/**
 * Tier 1 ambient engine — blink / idle sway / breath / look-around 등 로컬 생동감.
 * (PRD F5, event-dispatcher.md §8)
 *
 * 항상 켜짐, **backend 독립**(네트워크 X). renderer.onTick(rAF) 훅으로 매 프레임
 * bone(head/spine/chest) 회전 + blink expression을 vrm.update 직전에 쓴다.
 * 현재 이 채널들(head/spine/chest 회전, blink)을 ambient가 "소유"한다 — 매 프레임
 * 절대값으로 덮어쓴다. backend motion(#5) 합류 시 renderer가 weight 합성 책임을 진다
 * (§8: motion 재생 중 idle_sway weight 0.3→0.1). 그 hook은 #5에서.
 *
 * Cue 표 (event-dispatcher.md §8):
 *  - blink         : 3~6s 랜덤, 150ms 펄스
 *  - idle_sway     : 항상, head/spine 다주파 sine
 *  - breath        : 4s 주기, chest/spine sine
 *  - look_around   : 30~120s 무작위, head 시선 target shift (damped)
 *  - tap_react     : user.tap 시 1회 head bob(끄덕임) ~220ms
 *  - idle_returned : idle.returned 1회, 살짝 위 시선 ~900ms
 *
 * 순수 cue 수학은 ./cues.ts. 여기선 타이머·상태·VRM 쓰기만.
 */

import type { Object3D } from "three";
import type { Renderer, TickContext } from "../renderer";
import type { VRM } from "@pixiv/three-vrm";
import * as cues from "./cues";

export type AmbientCue =
  | "blink"
  | "idle_sway"
  | "breath"
  | "look_around"
  | "tap_react"
  | "idle_returned";

export interface Tier1Engine {
  /** renderer.onTick 훅 등록 + 주기 cue 시작. */
  start(): void;
  /** 일회성 cue 트리거 (tap_react / idle_returned 등 dispatcher tier1 라우팅). */
  trigger(cue: AmbientCue): void;
  /** 훅 해제 + 정지. */
  stop(): void;
}

// ── 진폭(라디안) — 전부 미묘하게. "살아있다"는 느낌이지 "춤"이 아니다. ──
const SWAY = {
  headYaw: 0.05,
  headPitch: 0.035,
  headRoll: 0.03,
  spinePitch: 0.02,
} as const;
const BREATH_AMP = 0.022; // 흉부 sine
const LOOK_LAMBDA = 1.8; // look target 댐핑 속도
const TAP_BOB_AMP = 0.13; // tap 끄덕임(아래로, pitch+)
const IDLE_RETURN_AMP = -0.09; // idle 복귀 시 살짝 위(pitch-)

/** VRM별로 1회 해석하는 능력(존재하는 bone/expression). 핫스왑(#4) 대비 재해석. */
interface Caps {
  head: Object3D | null;
  spine: Object3D | null;
  chest: Object3D | null;
  /** 사용할 blink expression 이름들 ('blink' 단일 또는 blinkLeft/Right). */
  blinkNames: string[];
}

interface OneShot {
  kind: "tap" | "idle_returned";
  /** tick 안에서 확정. -1 = 아직 미시작(다음 tick의 tMs로 확정). */
  startMs: number;
}

function prefersReducedMotion(): boolean {
  try {
    return (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    return false;
  }
}

export function createTier1Engine(renderer: Renderer): Tier1Engine {
  let unsub: (() => void) | null = null;
  let started = false;

  // VRM-별 캐시
  let capsVrm: VRM | null = null;
  let caps: Caps | null = null;

  // blink 상태 (ms 기준, ctx.elapsed*1000)
  let nextBlinkAtMs = cues.nextBlinkDelay();
  let blinkStartMs: number | null = null;

  // look_around 상태
  let nextLookAtMs = cues.nextLookDelay();
  let lookTargetYaw = 0;
  let lookTargetPitch = 0;
  let lookYaw = 0;
  let lookPitch = 0;

  // 일회성 cue
  const oneShots: OneShot[] = [];

  // reduced-motion (라이브 반영)
  let reduce = prefersReducedMotion();
  let mql: MediaQueryList | null = null;
  const onReduceChange = (e: MediaQueryListEvent): void => {
    reduce = e.matches;
  };

  function resolveCaps(vrm: VRM): Caps {
    const h = vrm.humanoid;
    const head = h?.getNormalizedBoneNode("head") ?? null;
    // chest가 없는 모델이 있어 upperChest→chest 순으로 폴백.
    const chest =
      h?.getNormalizedBoneNode("upperChest") ??
      h?.getNormalizedBoneNode("chest") ??
      null;
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

    // 핫스왑 대응: vrm 바뀌면 능력 재해석.
    if (vrm !== capsVrm) {
      capsVrm = vrm;
      caps = resolveCaps(vrm);
    }
    const c = caps!;

    // ── blink (reduced-motion에서도 유지 — 깜빡임은 전정 자극이 아님) ──
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

    // reduced-motion: blink만 두고 자세는 rest로 고정.
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

    // ── look_around ── (주기 도달 시 새 target, 매 프레임 damp)
    if (tMs >= nextLookAtMs) {
      const t = cues.nextLookTarget();
      lookTargetYaw = t.yaw;
      lookTargetPitch = t.pitch;
      nextLookAtMs = tMs + cues.nextLookDelay();
    }
    lookYaw = cues.damp(lookYaw, lookTargetYaw, LOOK_LAMBDA, dt);
    lookPitch = cues.damp(lookPitch, lookTargetPitch, LOOK_LAMBDA, dt);

    // ── 일회성(one-shot) cue 합성 + 만료 제거 ──
    let bobPitch = 0;
    for (let i = oneShots.length - 1; i >= 0; i--) {
      const os = oneShots[i];
      if (os.startMs < 0) os.startMs = tMs; // 첫 tick에서 시작 시각 확정
      const e = tMs - os.startMs;
      if (os.kind === "tap") {
        bobPitch += TAP_BOB_AMP * cues.bobEnvelope(e, cues.TAP_BOB_MS);
        if (e >= cues.TAP_BOB_MS) oneShots.splice(i, 1);
      } else {
        bobPitch += IDLE_RETURN_AMP * cues.bobEnvelope(e, cues.IDLE_RETURNED_MS);
        if (e >= cues.IDLE_RETURNED_MS) oneShots.splice(i, 1);
      }
    }

    // ── 합성 후 절대값 쓰기 (이 채널은 ambient 소유) ──
    if (c.head) {
      c.head.rotation.set(
        sway.headPitch * SWAY.headPitch + lookPitch + bobPitch, // x = pitch
        sway.headYaw * SWAY.headYaw + lookYaw, // y = yaw
        sway.headRoll * SWAY.headRoll, // z = roll
      );
    }
    // breath/sway를 spine·chest에 분배 (chest가 더 크게 숨쉬도록).
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
        /* matchMedia 없음(테스트 등) — 무시 */
      }
      unsub = renderer.onTick(tick);
    },
    trigger(cue) {
      // 일회성만 큐잉 (주기 cue는 자동). startMs는 다음 tick에서 확정(-1 sentinel).
      if (cue === "tap_react") oneShots.push({ kind: "tap", startMs: -1 });
      else if (cue === "idle_returned")
        oneShots.push({ kind: "idle_returned", startMs: -1 });
      // blink/idle_sway/breath/look_around 는 주기 엔진이 담당 — no-op.
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
