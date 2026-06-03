/**
 * Event bus — 모든 발화 후보 event의 단일 수집 지점. (placeholder, PRD F6 / event-dispatcher.md §4)
 *
 * priority heap, key = (tier ASC, ts ASC). 용량 100, 초과 시 우선순위 낮은 것부터 drop.
 * Bus drop 조건: schema invalid / 미지의 event_name / ts ±60s 벗어남 (§4.2).
 *
 * 지금은 envelope 타입 + push/subscribe 시그니처만. 실제 heap/검증은 M1.
 */

/** event_bus envelope (event-dispatcher.md §4.1). seq_id는 bus가 부여. */
export interface BusEnvelope {
  /** bus가 부여 (monotonic). push 시점엔 비어 있어도 됨. */
  seq_id?: number;
  source:
    | "timer_scheduler"
    | "idle_watcher"
    | "os_event_watcher"
    | "user_input_source"
    | "backend_push_source";
  /** event-dispatcher.md §3 표의 event_name. ex: "time_milestone.morning". */
  event_name: string;
  /** client epoch ms. */
  ts: number;
  payload?: Record<string, unknown>;
  /** source 추정 tier. dispatcher가 최종 결정 (§4.1). */
  hint_tier?: 1 | 2 | 3;
  /** user-initiated만 true (DND/debounce 우회, §6.1). */
  dnd_override?: boolean;
}

export interface EventBus {
  /** event를 큐에 push. 검증 통과 시 seq_id 부여 후 true. */
  push(env: BusEnvelope): boolean;
  /** dispatcher가 다음 처리 대상을 꺼냄 (tier ASC, ts ASC). */
  pop(): BusEnvelope | null;
  /** 현재 큐 스냅샷 (dev inspection, §11). */
  snapshot(): BusEnvelope[];
}

/**
 * Event bus 생성 (placeholder).
 * TODO(M1): priority heap + 용량 100 + §4.2 bus drop 검증.
 */
export function createEventBus(): EventBus {
  return {
    push(_env) {
      // TODO(M1): 검증 + seq_id 부여 + heap 삽입.
      return false;
    },
    pop() {
      return null;
    },
    snapshot() {
      return [];
    },
  };
}
