/**
 * Guardrails — DND / debounce / rate-limit. (placeholder, PRD F7 / event-dispatcher.md §6)
 *
 * 평가 순서(§6.4): DND → debounce → rate-limit → classify → route.
 * 각 단계 DROP은 reason 코드와 함께 dispatcher.drop 로그.
 *
 *  - DND(§6.1): Fullscreen / Camera / Active-app blocklist / Manual 4 trigger 중 하나라도 ON이면 DND_ON.
 *               DND_ON 시 tier 2/3 silent drop, tier 1 계속, dnd_override=true는 통과.
 *  - Debounce(§6.2): per source window (idle 30s / os 5s / backend_push 10s / user 0).
 *  - Rate-limit(§6.3): per tier rolling 60min (tier2 6회, tier3 2회, 전체 20회 → cooldown 5min).
 *
 * ⚠ 수치는 prototype 출발점 — config로 변경 가능, M3 후 1~2주 실사용 튜닝(§17 Q1).
 *
 * 지금은 상태 타입 + 평가 시그니처만. 실제 카운터/윈도우는 M3.
 */

import type { BusEnvelope } from "./event-bus";

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
  /** §6.4 순서로 한 event를 평가. pass=false면 drop. */
  evaluate(env: BusEnvelope, tier: 1 | 2 | 3): GuardResult;
}

/**
 * Guardrails 생성 (placeholder).
 * TODO(M3): DND 상태 머신 + per-source debounce window + per-tier rolling rate-limit.
 */
export function createGuardrails(): Guardrails {
  return {
    dndState() {
      return { on: false, reasons: [] };
    },
    setDnd(_reason, _on) {
      /* TODO(M3) */
    },
    evaluate(_env, _tier) {
      // TODO(M3): 실제 평가. 현재는 전부 통과 (개발 편의).
      return { pass: true };
    },
  };
}
