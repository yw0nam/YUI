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
 *   backend call이 연속 DEGRADED_FAILURE_THRESHOLD회 실패하면 진입한다 — 그 동안 tier2/3
 *   (non-user)은 degraded_drop으로 드롭하고, user-initiated(dnd_override) 턴은 게이트 없이
 *   계속 backend_caller로 나간다(judgment는 backend 소관). 호출이 1회라도 성공하면 즉시
 *   running으로 복귀하고 연속 실패 카운터도 리셋된다.
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
  reason: DropReason | "stale_pending" | "degraded_drop";
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
  degraded_drop: "warn",
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
  /** 진행 중 call abort + 보류 tier2/3 drop(client-only). bus sweep/tier1은 안 함. */
  cancel(): void;
  /** 상태 전이 구독. 매 전이마다 콜백 호출, unsubscribe fn 반환. */
  subscribeState(cb: (s: DispatcherState) => void): () => void;
  /** busy(=in-flight 유무) 전이 구독. idle⟷busy 경계에서만 호출, unsubscribe fn 반환. */
  subscribeBusy(cb: (busy: boolean) => void): () => void;
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
  if (n.startsWith("github.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("agent.")) {
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
/** 연속 backend call 실패 횟수 — 도달 시 degraded 진입. */
const DEGRADED_FAILURE_THRESHOLD = 3;

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
  // 연속 backend call 실패 카운터 — superseded_by_user는 실패로 세지 않는다.
  let consecutiveFailures = 0;

  const stateSubscribers = new Set<(s: DispatcherState) => void>();
  const busySubscribers = new Set<(busy: boolean) => void>();

  /** 상태 전이의 단일 경로: 할당 + state_change 로그 + 구독자 통지. */
  function setState(next: DispatcherState): void {
    if (next === state) return;
    const from = state;
    state = next;
    log.info("state_change", { from, to: next });
    for (const cb of stateSubscribers) cb(next);
  }

  /** in-flight 할당의 단일 경로: idle⟷busy 경계(null↔non-null)에서만 구독자 통지. */
  function setInFlight(next: typeof inFlight): void {
    const wasBusy = inFlight !== null;
    inFlight = next;
    const isBusy = inFlight !== null;
    if (wasBusy === isBusy) return;
    for (const cb of busySubscribers) cb(isBusy);
  }

  function recordDrop(env: BusEnvelope, reason: DropRecord["reason"]): void {
    drops.push({ seq_id: env.seq_id, event_name: env.event_name, reason, ts: env.ts });
    if (drops.length > MAX_DROP_RECORDS) drops.shift();
    log[DROP_SEVERITY[reason]]("drop", { event_name: env.event_name, reason, seq_id: env.seq_id });
  }

  /** backend call 성공: 연속 실패 카운터 리셋 + degraded면 즉시 복귀. */
  function noteCallSuccess(): void {
    consecutiveFailures = 0;
    if (state === "degraded") setState("running");
  }

  /** backend call 실패(superseded_by_user 제외): 임계치 도달 시 degraded 진입. */
  function noteCallFailure(): void {
    consecutiveFailures += 1;
    if (
      consecutiveFailures >= DEGRADED_FAILURE_THRESHOLD &&
      (state === "running" || state === "cooldown")
    ) {
      setState("degraded");
    }
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
      setInFlight(null);
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
    setInFlight({ trigger: env, started_at, abort });
    log.info("backend_call", { trigger: env.event_name, seq_id: env.seq_id, started_at });
    void backendCaller
      .call(env, abort.signal)
      .then((res) => {
        if (res.ok) {
          log.info("backend_call", { trigger: env.event_name, outcome: "ok" });
          noteCallSuccess();
        } else if (res.drop_reason) {
          log.info("backend_call", { trigger: env.event_name, outcome: res.drop_reason });
          if (res.drop_reason !== "superseded_by_user") {
            recordDrop(env, res.drop_reason);
            noteCallFailure();
          }
        }
      })
      .catch((err) => {
        log.error("backend_call.unexpected_error", { error: String(err) });
        log.info("backend_call", { trigger: env.event_name, outcome: "network_drop" });
        recordDrop(env, "network_drop");
        noteCallFailure();
      })
      .finally(() => {
        // 이 콜이 여전히 현재 in-flight일 때만 슬롯 해제(abort로 교체됐으면 건드리지 않음).
        // 곧장 drain할 보류가 있으면 슬롯을 비우지 않고 바로 다음 콜로 교체해
        // busy가 true→true로 유지된다(경계 통지 없음).
        if (inFlight && inFlight.trigger === env) {
          if (canDrain()) {
            startBackendCall(pending.shift()!);
          } else if (state === "degraded" && pending.length > 0) {
            // degraded 진입 순간 이미 보류 중이던 non-user 턴 — stale이니 drop.
            recordDrop(pending.shift()!, "degraded_drop");
            setInFlight(null);
          } else {
            setInFlight(null);
          }
        }
      });
  }

  /**
   * 지금 보류 1건을 다음 콜로 시작할 수 있는지(콜 완료 직후 슬롯 교체 판정용).
   * degraded 중엔 user 턴(dnd_override)만 drain — 그 외는 drop 대상(위 finally에서 처리).
   */
  function canDrain(): boolean {
    if (pending.length === 0) return false;
    if (state === "running") return true;
    if (state === "degraded") return pending[0]?.dnd_override === true;
    return false;
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
      // degraded 중엔 non-user(dnd_override 아님) tier2/3을 게이트보다 먼저 드롭한다 —
      // user-initiated 턴은 judgment를 backend에 맡기려 계속 통과시킨다.
      if (state === "degraded" && env.dnd_override !== true) {
        recordDrop(env, "degraded_drop");
        return;
      }
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
   * pump: 매 tick마다 bus를 drain. running/cooldown/degraded 모두에서 동작(각각 tier1은 항상 계속).
   * 그 외(booting/stopped/draining)면 no-op으로 보류 이벤트를 잡아 둔다.
   */
  function pump(): void {
    if (state !== "running" && state !== "cooldown" && state !== "degraded") return;
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
        setInFlight(null);
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
    cancel() {
      // client-only abort: 진행 중 call abort + 보류 drop. bus sweep/tier1 렌더는 안 함.
      if (inFlight) {
        log.info("abort", {
          event_name: inFlight.trigger.event_name,
          reason: "superseded_by_user",
        });
        inFlight.abort.abort();
        setInFlight(null);
      }
      while (pending.length > 0) {
        recordDrop(pending.shift()!, "superseded_by_user");
      }
    },
    subscribeState(cb) {
      stateSubscribers.add(cb);
      return () => {
        stateSubscribers.delete(cb);
      };
    },
    subscribeBusy(cb) {
      busySubscribers.add(cb);
      return () => {
        busySubscribers.delete(cb);
      };
    },
  };
}
