/**
 * Dispatcher — firing≠judgment 경계를 강제하는 단일 라우터.
 *
 * 흐름:
 *  1. event_bus.pop() → classify → tier.
 *  2. guardrails로 evaluate — user_input은 dnd_override=true로 통과.
 *  3. conflict resolution: user.text_submitted 도착 → in-flight backend abort +
 *     큐의 tier2/3 drop(superseded_by_user).
 *  4. 라우팅:
 *     · tier1 (user.drag_*, idle.returned, user.tap 즉시 half) → renderer (로컬, backend X).
 *     · tier2/3 (user.text_submitted, idle.*, time_milestone.*, os.active_app_changed) → backend_caller.
 *
 * 단일 in-flight backend call. 보류 tier2/3은 로컬 pending에 1건만 유지
 * (2건 이상 보류 시 가장 오래된 것 drop).
 *
 * state: booting → (start) → running → (stop) → stopped. cooldown은 guardrails의
 *   overall-cap verdict를 매 tick 폴링해 running↔cooldown으로 전이한다. degraded는
 *   선언만 되어 있고 진입 전이가 없다.
 * observable: queue() / recentDrops(n) / inFlight().
 */

import type { ControlEnvelope } from "../contract";
import type { Logger, LogLevel } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import type { BackendCaller } from "./backend-caller";
import type { BusEnvelope, EventBus } from "./event-bus";
import type { DropReason, Guardrails } from "./guardrails";

const baseLog = createLogger("dispatcher");

export interface DispatcherDeps {
  bus: EventBus;
  renderer: Pick<Renderer, "applyDirective" | "setPerchTarget">;
  backendCaller: BackendCaller;
  /** 가드레일 — DND/debounce/rate-limit 게이트 + cooldown verdict(순수). */
  guardrails: Guardrails;
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

/** recent_drops 항목. */
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

/** in_flight_backend_call. */
export interface InFlightInfo {
  trigger: BusEnvelope;
  started_at: number;
}

export interface Dispatcher {
  state(): DispatcherState;
  /** sources 구독 + 처리 루프 시작 (booting → running). */
  start(): void;
  /** 처리 루프 정지 + in-flight abort → stopped. */
  stop(): void;
  /** 현재 보류 큐 + bus 미처리분 스냅샷. */
  queue(): BusEnvelope[];
  /** 최근 n drop(reason 포함). */
  recentDrops(n?: number): DropRecord[];
  /** 진행 중 backend call(없으면 null). */
  inFlight(): InFlightInfo | null;
  /** 상태 전이 구독. 매 전이마다 콜백 호출, unsubscribe fn 반환. */
  subscribeState(cb: (s: DispatcherState) => void): () => void;
}

type Tier = 1 | 2 | 3;
type Target = "tier1" | "backend_caller" | "drop";

interface Classification {
  tier: Tier;
  target: Target;
}

/**
 * classify. 다루는 event만 라우팅, 나머지는 drop(=no-op).
 * user.tap은 tier1 즉시 half로 처리한다.
 */
function classify(env: BusEnvelope): Classification {
  const n = env.event_name;
  if (n === "user.text_submitted" || n === "user.voice_segment_ready") {
    return { tier: 2, target: "backend_caller" };
  }
  if (n === "idle.short" || n === "idle.long" || n.startsWith("time_milestone.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("proactive.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("schedule.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n === "os.active_app_changed") {
    return { tier: 3, target: "backend_caller" };
  }
  if (
    n === "user.drag_start" ||
    n === "user.drag_end" ||
    n === "idle.returned" ||
    n === "user.tap" ||
    n === "user.window_sit_enter" ||
    n === "user.window_sit_exit" ||
    n === "user.window_sit_drop"
  ) {
    return { tier: 1, target: "tier1" };
  }
  return { tier: (env.hint_tier ?? 3) as Tier, target: "drop" };
}

/**
 * tier1 event → render directive 매핑(로컬, backend 독립).
 *  - drag_start → motion "drag" 재생 / drag_end → idle 복귀(motion null).
 *  - user.tap / idle.returned → 빈 directive(hold).
 * 반환 null이면 render 안 함.
 */
function tier1Directive(env: BusEnvelope): ControlEnvelope | null {
  switch (env.event_name) {
    case "user.drag_start":
      return { speech_text: "", motion: { id: "drag" } };
    case "user.drag_end":
      return { speech_text: "", motion: null };
    case "user.window_sit_enter":
      return { speech_text: "", motion: { id: "window_sit" } };
    case "user.window_sit_drop":
      return { speech_text: "", motion: { id: "window_sit" } };
    case "user.window_sit_exit":
      return { speech_text: "", motion: null };
    case "user.tap":
    case "idle.returned":
      // 빈 directive(emotion/motion 미지정 = hold).
      return { speech_text: "" };
    default:
      return null;
  }
}

const DEFAULT_PUMP_MS = 16;
const MAX_DROP_RECORDS = 50;

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { bus, renderer, backendCaller, guardrails } = deps;
  const pumpMs = deps.pumpIntervalMs ?? DEFAULT_PUMP_MS;
  const log = deps.logger ?? baseLog;

  let state: DispatcherState = "booting";
  let timer: ReturnType<typeof setInterval> | null = null;

  // 단일 in-flight backend call (1건만, 나머지 보류).
  let inFlight: { trigger: BusEnvelope; started_at: number; abort: AbortController } | null = null;
  // 보류 tier2/3 (2건 이상이면 가장 오래된 것 drop).
  const pending: BusEnvelope[] = [];
  const drops: DropRecord[] = [];

  const stateSubscribers = new Set<(s: DispatcherState) => void>();

  /** 상태 전이의 단일 경로: 할당 + state_change 로그 + 구독자 통지. */
  function setState(next: DispatcherState): void {
    if (next === state) return;
    const from = state;
    state = next;
    log.info("state_change", { from, to: next });
    for (const cb of stateSubscribers) cb(next);
  }

  function recordDrop(env: BusEnvelope, reason: DropRecord["reason"]): void {
    drops.push({ seq_id: env.seq_id, event_name: env.event_name, reason, ts: env.ts });
    if (drops.length > MAX_DROP_RECORDS) drops.shift();
    log[DROP_SEVERITY[reason]]("drop", { event_name: env.event_name, reason, seq_id: env.seq_id });
  }

  /**
   * user.text_submitted 도착 → in-flight abort + 보류 tier2/3 전부 drop +
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

  /** 보류 큐에서 다음 tier2/3 1건을 꺼내 in-flight가 비었으면 시작. 비-running이면 보류. */
  function drainPending(): void {
    if (inFlight || pending.length === 0 || state !== "running") return;
    startBackendCall(pending.shift()!);
  }

  /** tier2/3 enqueue: in-flight 비면 즉시 시작, 아니면 보류(2건 이상이면 oldest drop). */
  function enqueueBackend(env: BusEnvelope): void {
    if (!inFlight) {
      startBackendCall(env);
      return;
    }
    pending.push(env);
    // 2건 이상 보류 시 가장 오래된 것 drop(stale).
    while (pending.length > 1) {
      recordDrop(pending.shift()!, "stale_pending");
    }
  }

  /** tier1 event → renderer.applyDirective (로컬, backend 독립). */
  function renderTier1(env: BusEnvelope): void {
    const directive = tier1Directive(env);
    if (!directive) return;
    log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier: 1 });
    // perch-clear first so applyDirective's motion is the last playMotion and is
    // not clobbered by setPerchTarget(null)'s internal playMotion(null).
    applyPerchTarget(env);
    try {
      renderer.applyDirective(directive);
    } catch (err) {
      log.error("tier1.render_error", { error: String(err) });
    }
  }

  /**
   * Perch-target side-channel — client-only geometry handed to the renderer,
   * NOT carried in the ControlEnvelope (keeps the agent contract clean):
   *  - window_sit_drop → setPerchTarget({edgeLocalYpx}); skip + warn if malformed.
   *  - window_sit_exit → setPerchTarget(null), always clear the perch.
   *  - drag_start → setPerchTarget(null), unpin the stale edge at grab.
   *  - window_sit_enter (sit-in-place) → no perch target.
   */
  function applyPerchTarget(env: BusEnvelope): void {
    try {
      if (env.event_name === "user.window_sit_exit" || env.event_name === "user.drag_start") {
        renderer.setPerchTarget(null);
        return;
      }
      if (env.event_name === "user.window_sit_drop") {
        const edge = env.payload?.edge_local_ypx;
        if (typeof edge !== "number" || !Number.isFinite(edge)) {
          log.warn("perch_target.malformed", { seq_id: env.seq_id, payload: env.payload });
          return;
        }
        renderer.setPerchTarget({ edgeLocalYpx: edge });
      }
    } catch (err) {
      log.error("tier1.perch_target_error", { error: String(err) });
    }
  }

  /**
   * dispatcher가 running ↔ cooldown 전이를 소유한다. guardrail은 verdict만 반환하고
   * 전이에 관여하지 않으므로, 매 tick cooldownActive()를 폴링해 state를 동기화한다(진입/종료 함께).
   */
  function syncCooldownState(): void {
    const inCooldown = guardrails.cooldownActive();
    if (inCooldown && state === "running") {
      setState("cooldown");
    } else if (!inCooldown && state === "cooldown") {
      setState("running");
    }
  }

  function handle(env: BusEnvelope): void {
    // DND 상태 갱신은 분류/평가 이전에 — note는 envelope→setDnd thin translator.
    guardrails.note(env);

    // user.text_submitted는 분류 전에 supersede를 먼저 적용한다.
    if (env.event_name === "user.text_submitted") {
      supersedeByUser();
    }

    const { tier, target } = classify(env);
    if (target === "tier1") {
      // tier1은 절대 게이트하지 않는다(DND/cooldown 무관).
      renderTier1(env);
      return;
    }
    if (target === "backend_caller") {
      // classify로 tier 획득 후 evaluate. drop이면 enqueue하지 않는다.
      const verdict = guardrails.evaluate(env, tier);
      if (!verdict.pass) {
        recordDrop(env, verdict.reason);
        return;
      }
      log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier });
      enqueueBackend(env);
      return;
    }
    // target === "drop": 다루지 않는 event (no-op — bus가 이미 미지의 event_name은 거름).
  }

  /**
   * pump: 매 tick마다 bus를 drain. running/cooldown 모두에서 동작(cooldown 중 tier1 계속).
   * 그 외 비-running이면 no-op으로 보류 이벤트를 잡아 둔다.
   */
  function pump(): void {
    if (state !== "running" && state !== "cooldown") return;
    let env: BusEnvelope | null;
    while ((env = bus.pop()) !== null) {
      handle(env);
    }
    // backend 평가가 cooldown을 진입시켰거나 타이머가 종료시켰을 수 있다 → state 동기화.
    syncCooldownState();
  }

  return {
    state() {
      return state;
    },
    start() {
      if (state === "running") return;
      setState("running");
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
      setState("stopped");
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
    subscribeState(cb) {
      stateSubscribers.add(cb);
      return () => {
        stateSubscribers.delete(cb);
      };
    },
  };
}
