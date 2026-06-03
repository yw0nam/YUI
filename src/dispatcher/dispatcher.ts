/**
 * Dispatcher — firing≠judgment 경계를 강제하는 단일 라우터. (placeholder, PRD F6 / event-dispatcher.md §5,§7)
 *
 * 흐름(§2, §5):
 *  1. event_bus.pop() → classify → tier (§5.1).
 *  2. guardrails: DND → debounce → rate-limit (§6.4).
 *  3. conflict resolution (§5.2): debounce 덮어쓰기 / in-flight 보류 / user.text_submitted abort.
 *  4. 라우팅:
 *     · tier1 → tier1_ambient_engine (로컬, backend X).
 *     · tier2/3 → backend_caller → POST /v1/responses → express + 텍스트 스트림 파싱 → renderer.
 *
 * firing(언제 후보 event가 생겼나)만 client 책임. judgment(말할지/무엇을)는 backend
 * (should_speak=false → silent drop). concept.md §0 핵심 분리 원칙.
 *
 * 지금은 배선 시그니처만. 실제 라우팅/backend_caller(§7 B1~B5)는 M1~M2.
 */

import type { EventBus } from "./event-bus";
import type { Guardrails } from "./guardrails";
import type { Renderer } from "../renderer";

export interface DispatcherDeps {
  bus: EventBus;
  guardrails: Guardrails;
  renderer: Renderer;
}

export type DispatcherState =
  | "booting"
  | "running"
  | "cooldown"
  | "degraded"
  | "draining"
  | "stopped";

export interface Dispatcher {
  state(): DispatcherState;
  /** sources 구독 + 처리 루프 시작 (booting → running). */
  start(): void;
  /** draining 5s 후 stopped (§9). */
  stop(): void;
}

/**
 * Dispatcher 생성 (placeholder).
 * TODO(M1): bus 처리 루프 + classify/guardrail/route + backend_caller(§7) 배선.
 */
export function createDispatcher(_deps: DispatcherDeps): Dispatcher {
  return {
    state() {
      return "booting";
    },
    start() {
      /* TODO(M1) */
    },
    stop() {
      /* TODO(M1) */
    },
  };
}
