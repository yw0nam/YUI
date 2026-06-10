/**
 * Guardrails — DND / debounce / rate-limit.
 *
 * 평가 순서: DND → debounce → rate-limit. dispatcher wiring 순서는
 * supersede → classify(tier) → evaluate(env, tier) → route. dnd_override는 evaluate
 * 최상단에서 short-circuit — user-initiated 턴은 모든 게이트를 우회하며 어떤 카운터도 증가시키지 않는다.
 *
 *  - DND: Fullscreen / Camera / Active-app blocklist / Manual 4 trigger 중 하나라도 ON이면 DND_ON.
 *               note()는 envelope → setDnd 호출로 옮기는 thin translator(상태는 setDnd가 소유).
 *  - Debounce: per source window. now() − lastFire[source] < window면 drop.
 *  - Rate-limit: per tier rolling window. 슬롯은 발사(=pass) 시 소비, 환불 없음.
 *               전체 overall_max 초과 시 cooldownUntil 설정(진입/종료 전이는 dispatcher가 소유).
 *
 * 평가 함수는 순수(verdict만 반환) — dispatcher state를 mutate하지 않고 dispatcher 참조도 없다.
 * 시간은 주입한 now()로만 읽는다(bare Date.now() 금지).
 */

import type { BusEnvelope } from "./event-bus";
import type { GuardrailsConfig } from "../config/load";

export type { GuardrailsConfig };

export type DndReason = "fullscreen" | "camera" | "active_app" | "manual";

export interface DndState {
  on: boolean;
  reasons: DndReason[];
}

export type DropReason =
  | "guardrail_drop"
  | "parse_error"
  | "network_drop"
  | "http_4xx_drop"
  | "superseded_by_user";

/** 가드레일 통과/탈락 판정 결과. */
export type GuardResult =
  | { pass: true }
  | { pass: false; reason: DropReason; detail: string };

export interface Guardrails {
  dndState(): DndState;
  /** DND trigger 토글 (os.fullscreen_* / os.camera_in_use / user.dnd_toggle 등). */
  setDnd(reason: DndReason, on: boolean): void;
  /** envelope → 최대 1회 setDnd 호출로 옮기는 thin translator(DND 상태 갱신). */
  note(env: BusEnvelope): void;
  /** 순서대로 한 event를 평가. pass=false면 drop. pass 시에만 debounce/rate state mutate. */
  evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult;
  /** overall-cap 초과로 진입한 cooldown이 아직 유효한지(now < cooldownUntil). */
  cooldownActive(): boolean;
  /** 핫리로드: config 수치만 교체(런타임 DND/카운터 상태는 보존). */
  setConfig(next: GuardrailsConfig): void;
}

type Source = BusEnvelope["source"];

export interface CreateGuardrailsOptions {
  /** 시간 주입. default () => Date.now(). 모든 윈도우/쿨다운이 이 함수만 읽는다. */
  now?: () => number;
}

/** payload[key]가 boolean이면 반환, 아니면 undefined(필드 부재는 graceful no-op). */
function boolField(env: BusEnvelope, key: string): boolean | undefined {
  const v = env.payload?.[key];
  return typeof v === "boolean" ? v : undefined;
}

/** payload[key]가 non-empty string이면 반환, 아니면 undefined. */
function strField(env: BusEnvelope, key: string): string | undefined {
  const v = env.payload?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function createGuardrails(
  initialConfig: GuardrailsConfig,
  opts: CreateGuardrailsOptions = {},
): Guardrails {
  const now = opts.now ?? (() => Date.now());
  // 핫리로드로 교체 가능 — 런타임 상태(DND reasons / 카운터 / cooldown)는 보존한다.
  let config = initialConfig;

  // DND 상태의 단일 소스 — setDnd만 변경한다. camera는 idle-off 클록 윈도우로 별도 추적.
  const dndReasons = new Set<DndReason>();
  let lastCameraActive: number | null = null;

  // debounce: source별 마지막 통과 시각.
  const lastFire = new Map<Source, number>();

  // rate-limit: tier별 + 전체 rolling 윈도우(통과 시각 epoch ms).
  const tier2Window: number[] = [];
  const tier3Window: number[] = [];
  const overallWindow: number[] = [];
  let cooldownUntil = 0;

  /** camera idle-off 클록을 반영해 현재 DND reason 집합을 계산한다. */
  function activeReasons(): DndReason[] {
    if (
      dndReasons.has("camera") &&
      lastCameraActive !== null &&
      now() - lastCameraActive >= config.dnd.camera_idle_off_ms
    ) {
      dndReasons.delete("camera");
    }
    return [...dndReasons];
  }

  function setDnd(reason: DndReason, on: boolean): void {
    if (on) {
      dndReasons.add(reason);
      if (reason === "camera") lastCameraActive = now();
    } else {
      dndReasons.delete(reason);
      if (reason === "camera") lastCameraActive = null;
    }
  }

  function note(env: BusEnvelope): void {
    switch (env.event_name) {
      case "os.fullscreen_entered":
        setDnd("fullscreen", true);
        return;
      case "os.fullscreen_exited":
        setDnd("fullscreen", false);
        return;
      case "os.camera_in_use": {
        const inUse = boolField(env, "camera_in_use");
        if (inUse === undefined) return; // payload 미상 → graceful no-op
        setDnd("camera", inUse);
        return;
      }
      case "os.active_app_changed": {
        const app = strField(env, "active_app_name");
        if (app === undefined) return;
        setDnd("active_app", config.dnd.app_blocklist.includes(app));
        return;
      }
      case "user.dnd_toggle":
        setDnd("manual", !dndReasons.has("manual"));
        return;
      default:
        return;
    }
  }

  /** rolling 윈도우에서 now() − window_ms 이전 항목을 앞에서 제거. */
  function prune(window: number[]): void {
    const cutoff = now() - config.rate_limit.window_ms;
    while (window.length > 0 && window[0] <= cutoff) window.shift();
  }

  function evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult {
    // 1) dnd_override: 최상단 short-circuit. 어떤 카운터/디바운스도 증가시키지 않는다.
    if (env.dnd_override === true) return { pass: true };

    // 2) DND: 하나라도 on이면 drop.
    const reasons = activeReasons();
    if (reasons.length > 0) {
      return { pass: false, reason: "guardrail_drop", detail: `dnd:${reasons.join(",")}` };
    }

    // 3) cooldown: 진입한 cooldown이 유효하면 drop.
    if (now() < cooldownUntil) {
      return { pass: false, reason: "guardrail_drop", detail: "cooldown" };
    }

    // 4) debounce: source별 윈도우. timer_scheduler는 N/A(자체 1회) → window 0(디바운스 없음).
    const window = (config.debounce_ms as Record<Source, number>)[env.source] ?? 0;
    const last = lastFire.get(env.source);
    if (window > 0 && last !== undefined && now() - last < window) {
      return { pass: false, reason: "guardrail_drop", detail: `debounce:${env.source}` };
    }

    // 5) rate-limit: tier 윈도우 prune 후 cap, 그 다음 overall cap.
    prune(tier2Window);
    prune(tier3Window);
    prune(overallWindow);
    if (tier === 2 && tier2Window.length >= config.rate_limit.tier2_max) {
      return { pass: false, reason: "guardrail_drop", detail: "rate_limit:tier2" };
    }
    if (tier === 3 && tier3Window.length >= config.rate_limit.tier3_max) {
      return { pass: false, reason: "guardrail_drop", detail: "rate_limit:tier3" };
    }
    if (overallWindow.length >= config.rate_limit.overall_max) {
      cooldownUntil = now() + config.rate_limit.cooldown_ms;
      return { pass: false, reason: "guardrail_drop", detail: "cooldown_entered" };
    }

    // 6) pass: 발사 시점에 슬롯 소비(환불 없음).
    lastFire.set(env.source, now());
    if (tier === 2) tier2Window.push(now());
    if (tier === 3) tier3Window.push(now());
    overallWindow.push(now());
    return { pass: true };
  }

  return {
    dndState() {
      const reasons = activeReasons();
      return { on: reasons.length > 0, reasons };
    },
    setDnd,
    note,
    evaluate,
    cooldownActive() {
      return now() < cooldownUntil;
    },
    setConfig(next) {
      config = next;
    },
  };
}
