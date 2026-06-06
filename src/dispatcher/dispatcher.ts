/**
 * Dispatcher — firing≠judgment 경계를 강제하는 단일 라우터. (PRD F6 / event-dispatcher.md §5,§7,§9,§11)
 *
 * 흐름(§2, §5):
 *  1. event_bus.pop() → classify → tier (§5.1).
 *  2. (가드레일 §6은 #25 — 지금은 user_input dnd_override=true로 통과. seam만 둠.)
 *  3. conflict resolution (§5.2): user.text_submitted 도착 → in-flight backend abort +
 *     큐의 tier2/3 drop(superseded_by_user).
 *  4. 라우팅:
 *     · tier1 (user.drag_*, idle.returned, user.tap 즉시 half) → renderer (로컬, backend X).
 *     · tier2/3 (user.text_submitted, idle.*, time_milestone.*, os.active_app_changed) → backend_caller.
 *
 * MVP(#21 spine): 단일 in-flight backend call. 보류 tier2/3은 로컬 pending에 1건만 유지
 * (2건 이상 보류 시 가장 오래된 것 drop, §5.2). guardrails/timer/idle source는 후속(#24/#25).
 *
 * §9 state: booting → (start) → running → (stop) → stopped.
 *   cooldown/degraded는 최소 스텁(전이 트리거 미구현 — rate-limit #25 / 에러누적 추후).
 * §11 observable: queue() / recentDrops(n) / inFlight().
 */

import type { EventBus, BusEnvelope } from "./event-bus";
import type { Renderer } from "../renderer";
import type { BackendCaller } from "./backend-caller";
import type { DropReason } from "./guardrails";
import type { ControlEnvelope } from "../contract";
import { createLogger } from "../logger";
import type { Logger, LogLevel } from "../logger";

const baseLog = createLogger("dispatcher");

export interface DispatcherDeps {
  bus: EventBus;
  renderer: Pick<Renderer, "applyDirective">;
  backendCaller: BackendCaller;
  /** pump 주기(ms). default 16(rAF 대략). 테스트는 fake timer로 advance. */
  pumpIntervalMs?: number;
  /** 구조화 로깅(없으면 dispatcher namespace logger). */
  logger?: Logger;
}

export type DispatcherState =
  | "booting"
  | "running"
  | "cooldown"
  | "degraded"
  | "draining"
  | "stopped";

/** §11 recent_drops 항목. */
export interface DropRecord {
  seq_id?: number;
  event_name: string;
  reason: DropReason | "stale_pending";
  ts: number;
}

/** drop reason → log severity. Record가 누락 key를 컴파일 에러로 강제한다. */
export const DROP_SEVERITY: Record<DropRecord["reason"], LogLevel> = {
  guardrail_drop: "info",
  parse_error: "warn",
  network_drop: "warn",
  http_4xx_drop: "error",
  superseded_by_user: "info",
  stale_pending: "info",
};

/** §11 in_flight_backend_call. */
export interface InFlightInfo {
  trigger: BusEnvelope;
  started_at: number;
}

export interface Dispatcher {
  state(): DispatcherState;
  /** sources 구독 + 처리 루프 시작 (booting → running). */
  start(): void;
  /** 처리 루프 정지 + in-flight abort → stopped (§9). */
  stop(): void;
  /** §11 현재 보류 큐 + bus 미처리분 스냅샷. */
  queue(): BusEnvelope[];
  /** §11 최근 n drop(reason 포함). */
  recentDrops(n?: number): DropRecord[];
  /** §11 진행 중 backend call(없으면 null). */
  inFlight(): InFlightInfo | null;
}

type Tier = 1 | 2 | 3;
type Target = "tier1" | "backend_caller" | "drop";

interface Classification {
  tier: Tier;
  target: Target;
}

/**
 * §5.1 classify. MVP에서 다루는 event만 라우팅, 나머지는 drop(=no-op, MVP 범위 밖).
 * user.tap은 tier1 즉시 half만 구현(tier2 가드레일 half는 #25).
 */
function classify(env: BusEnvelope): Classification {
  const n = env.event_name;
  if (n === "user.text_submitted" || n === "user.voice_segment_ready") {
    return { tier: 2, target: "backend_caller" };
  }
  if (n === "idle.short" || n === "idle.long" || n.startsWith("time_milestone.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n === "os.active_app_changed") {
    return { tier: 3, target: "backend_caller" };
  }
  if (
    n === "user.drag_start" ||
    n === "user.drag_end" ||
    n === "idle.returned" ||
    n === "user.tap"
  ) {
    return { tier: 1, target: "tier1" };
  }
  return { tier: (env.hint_tier ?? 3) as Tier, target: "drop" };
}

/**
 * tier1 event → render directive 매핑(로컬, backend 독립).
 *  - drag_start → motion "drag" 재생 / drag_end → idle 복귀(motion null).
 *  - user.tap / idle.returned → ambient cue (#10에서 정교화). MVP는 빈 directive(hold).
 * 반환 null이면 render 안 함.
 */
function tier1Directive(env: BusEnvelope): ControlEnvelope | null {
  switch (env.event_name) {
    case "user.drag_start":
      return { speech_text: "", motion: { id: "drag" } };
    case "user.drag_end":
      return { speech_text: "", motion: null };
    case "user.tap":
    case "idle.returned":
      // ambient cue는 #10 — 지금은 빈 directive(emotion/motion 미지정 = hold)로 seam만 둔다.
      return { speech_text: "" };
    default:
      return null;
  }
}

const DEFAULT_PUMP_MS = 16;
const MAX_DROP_RECORDS = 50;

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { bus, renderer, backendCaller } = deps;
  const pumpMs = deps.pumpIntervalMs ?? DEFAULT_PUMP_MS;
  const log = deps.logger ?? baseLog;

  let state: DispatcherState = "booting";
  let timer: ReturnType<typeof setInterval> | null = null;

  // 단일 in-flight backend call (§5.2: 1건만, 나머지 보류).
  let inFlight: { trigger: BusEnvelope; started_at: number; abort: AbortController } | null = null;
  // 보류 tier2/3 (§5.2: 2건 이상이면 가장 오래된 것 drop).
  const pending: BusEnvelope[] = [];
  const drops: DropRecord[] = [];

  function recordDrop(env: BusEnvelope, reason: DropRecord["reason"]): void {
    drops.push({ seq_id: env.seq_id, event_name: env.event_name, reason, ts: env.ts });
    if (drops.length > MAX_DROP_RECORDS) drops.shift();
    log[DROP_SEVERITY[reason]]("drop", { event_name: env.event_name, reason, seq_id: env.seq_id });
  }

  /**
   * §5.2 / §14: user.text_submitted 도착 → in-flight abort + 보류 tier2/3 전부 drop +
   * bus에 아직 남아 있는 tier2/3도 sweep해 drop. tier1은 그대로 즉시 처리해 남긴다.
   * (bus는 우선순위 큐라 user가 먼저 pop되므로, 같은 pump의 후행 tier2/3까지 here에서 비운다.)
   */
  function supersedeByUser(): void {
    if (inFlight) {
      log.info("abort", { event_name: inFlight.trigger.event_name, reason: "superseded_by_user" });
      inFlight.abort.abort();
      inFlight = null;
    }
    while (pending.length > 0) {
      recordDrop(pending.shift()!, "superseded_by_user");
    }
    // bus에 남은 tier2/3 sweep: backend로 갈 것은 drop, tier1은 즉시 렌더해 보존.
    let env: BusEnvelope | null;
    const tier1Leftover: BusEnvelope[] = [];
    while ((env = bus.pop()) !== null) {
      const { target } = classify(env);
      if (target === "backend_caller") {
        recordDrop(env, "superseded_by_user");
      } else if (target === "tier1") {
        tier1Leftover.push(env);
      }
      // target === "drop": no-op.
    }
    for (const t of tier1Leftover) renderTier1(t);
  }

  /** tier2/3 backend call 시작(in-flight 점유). 완료 시 슬롯 비우고 보류 1건 drain. */
  function startBackendCall(env: BusEnvelope): void {
    const abort = new AbortController();
    const started_at = Date.now();
    inFlight = { trigger: env, started_at, abort };
    log.info("backend_call", { trigger: env.event_name, seq_id: env.seq_id, started_at });
    void backendCaller
      .call(env, abort.signal)
      .then((res) => {
        if (res.ok) {
          log.info("backend_call", { trigger: env.event_name, outcome: "ok" });
        } else if (res.drop_reason) {
          log.info("backend_call", { trigger: env.event_name, outcome: res.drop_reason });
          if (res.drop_reason !== "superseded_by_user") recordDrop(env, res.drop_reason);
        }
      })
      .catch((err) => {
        log.error("backend_call.unexpected_error", { error: String(err) });
        log.info("backend_call", { trigger: env.event_name, outcome: "network_drop" });
        recordDrop(env, "network_drop");
      })
      .finally(() => {
        // 이 콜이 여전히 현재 in-flight일 때만 슬롯 해제(abort로 교체됐으면 건드리지 않음).
        if (inFlight && inFlight.trigger === env) inFlight = null;
        drainPending();
      });
  }

  /** 보류 큐에서 다음 tier2/3 1건을 꺼내 in-flight가 비었으면 시작. */
  function drainPending(): void {
    if (inFlight || pending.length === 0) return;
    startBackendCall(pending.shift()!);
  }

  /** tier2/3 enqueue: in-flight 비면 즉시 시작, 아니면 보류(2건 이상이면 oldest drop §5.2). */
  function enqueueBackend(env: BusEnvelope): void {
    if (!inFlight) {
      startBackendCall(env);
      return;
    }
    pending.push(env);
    // §5.2: 2건 이상 보류 시 가장 오래된 것 drop(stale).
    while (pending.length > 1) {
      recordDrop(pending.shift()!, "stale_pending");
    }
  }

  /** tier1 event → renderer.applyDirective (로컬, backend 독립). */
  function renderTier1(env: BusEnvelope): void {
    const directive = tier1Directive(env);
    if (!directive) return;
    log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier: 1 });
    try {
      renderer.applyDirective(directive);
    } catch (err) {
      log.error("tier1.render_error", { error: String(err) });
    }
  }

  function handle(env: BusEnvelope): void {
    // §5.2: user.text_submitted는 분류 전에 supersede를 먼저 적용한다.
    if (env.event_name === "user.text_submitted") {
      supersedeByUser();
    }

    const { tier, target } = classify(env);
    if (target === "tier1") {
      renderTier1(env);
      return;
    }
    if (target === "backend_caller") {
      log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier });
      enqueueBackend(env);
      return;
    }
    // target === "drop": MVP 범위 밖 event (no-op — bus가 이미 미지의 event_name은 거름).
  }

  /** pump: 매 tick마다 bus를 drain. */
  function pump(): void {
    if (state !== "running") return;
    let env: BusEnvelope | null;
    while ((env = bus.pop()) !== null) {
      handle(env);
    }
  }

  return {
    state() {
      return state;
    },
    start() {
      if (state === "running") return;
      const from = state;
      state = "running";
      log.info("state_change", { from, to: "running" });
      timer = setInterval(pump, pumpMs);
      // 즉시 한 번 drain(첫 tick 전 push된 event 대응).
      pump();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (inFlight) {
        inFlight.abort.abort();
        inFlight = null;
      }
      pending.length = 0;
      const from = state;
      state = "stopped";
      log.info("state_change", { from, to: "stopped" });
    },
    queue() {
      // 보류 + bus 미처리분(스냅샷)을 합쳐 노출.
      return [...pending, ...bus.snapshot()];
    },
    recentDrops(n = 10) {
      return drops.slice(-n);
    },
    inFlight() {
      return inFlight ? { trigger: inFlight.trigger, started_at: inFlight.started_at } : null;
    },
  };
}
