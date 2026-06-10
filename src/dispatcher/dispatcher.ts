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

import type { EventBus, BusEnvelope } from "./event-bus";
import type { Renderer } from "../renderer";
import type { BackendCaller } from "./backend-caller";
import type { DropReason, Guardrails } from "./guardrails";
import type { ControlEnvelope } from "../contract";
import type { CompactResult } from "../io/session-compactor";
import { createLogger } from "../logger";
import type { Logger, LogLevel } from "../logger";

const baseLog = createLogger("dispatcher");

export interface DispatcherDeps {
  bus: EventBus;
  renderer: Pick<Renderer, "applyDirective">;
  backendCaller: BackendCaller;
  /** 가드레일 — DND/debounce/rate-limit 게이트 + cooldown verdict(순수). */
  guardrails: Guardrails;
  /** pump 주기(ms). default 16(rAF 대략). 테스트는 fake timer로 advance. */
  pumpIntervalMs?: number;
  /** 구조화 로깅(없으면 dispatcher namespace logger). */
  logger?: Logger;
  /** 세션 압축 thunk(main.ts에서 조립). 없으면 requestCompaction은 no-op. */
  compact?: (signal: AbortSignal) => Promise<CompactResult>;
  /** 현재 세션 id 해소. falsy면 압축할 세션이 없어 requestCompaction skip. */
  getSessionId?: () => string | undefined;
  /** compact() timeout(ms). default 12000. 초과 시 abort + running 복귀. */
  compactTimeoutMs?: number;
}

export type DispatcherState =
  | "booting"
  | "running"
  | "cooldown"
  | "degraded"
  | "draining"
  | "compacting"
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
  /** 세션 압축 요청을 래치한다. idempotent; 세션/compact 부재·이미 compacting·stopped면 no-op. */
  requestCompaction(): void;
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
  if (n === "os.active_app_changed") {
    return { tier: 3, target: "backend_caller" };
  }
  if (
    n === "user.drag_start" ||
    n === "user.drag_end" ||
    n === "idle.returned" ||
    n === "user.tap" ||
    n === "user.window_sit_enter" ||
    n === "user.window_sit_exit"
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
const DEFAULT_COMPACT_TIMEOUT_MS = 12_000;
const MAX_DROP_RECORDS = 50;

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { bus, renderer, backendCaller, guardrails } = deps;
  const pumpMs = deps.pumpIntervalMs ?? DEFAULT_PUMP_MS;
  const compactTimeoutMs = deps.compactTimeoutMs ?? DEFAULT_COMPACT_TIMEOUT_MS;
  const log = deps.logger ?? baseLog;

  let state: DispatcherState = "booting";
  let timer: ReturnType<typeof setInterval> | null = null;

  // 단일 in-flight backend call (1건만, 나머지 보류).
  let inFlight: { trigger: BusEnvelope; started_at: number; abort: AbortController } | null = null;
  // 보류 tier2/3 (2건 이상이면 가장 오래된 것 drop).
  const pending: BusEnvelope[] = [];
  const drops: DropRecord[] = [];

  // 세션 압축 래치: set이면 새 backend 턴은 enqueue/drain에서 보류된다(BLOCKER 1).
  let compactionRequested = false;
  let compactAbort: AbortController | null = null;
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
        // 경계 도달(inFlight===null && compactionRequested): 압축이 다음 턴보다 먼저(BLOCKER 2).
        if (maybeStartCompaction()) return;
        drainPending();
      });
  }

  /** 보류 큐에서 다음 tier2/3 1건을 꺼내 in-flight가 비었으면 시작. 압축 래치/비-running이면 보류. */
  function drainPending(): void {
    if (inFlight || pending.length === 0 || state !== "running" || compactionRequested) return;
    startBackendCall(pending.shift()!);
  }

  /** tier2/3 enqueue: in-flight 비면 즉시 시작, 아니면 보류(2건 이상이면 oldest drop). */
  function enqueueBackend(env: BusEnvelope): void {
    // 압축 래치 중에는 새 턴을 절대 시작하지 않는다 — 보류만(BLOCKER 1).
    if (!inFlight && !compactionRequested) {
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
    try {
      renderer.applyDirective(directive);
    } catch (err) {
      log.error("tier1.render_error", { error: String(err) });
    }
  }

  /**
   * dispatcher가 running ↔ cooldown 전이를 소유한다. guardrail은 verdict만 반환하고
   * 전이에 관여하지 않으므로, 매 tick cooldownActive()를 폴링해 state를 동기화한다(진입/종료 함께).
   * compacting은 별개 게이트라 폴링 대상에서 제외한다(running ↔ cooldown만 동기화).
   */
  function syncCooldownState(): void {
    const inCooldown = guardrails.cooldownActive();
    if (inCooldown && state === "running") {
      setState("cooldown");
    } else if (!inCooldown && state === "cooldown") {
      setState("running");
    }
  }

  /** compacting busy cue. render 에러가 상태머신을 깨뜨리지 않도록 try/catch. */
  function applyCue(emotionId: "thinking" | "neutral"): void {
    try {
      renderer.applyDirective({ speech_text: "", emotion: { id: emotionId } });
    } catch (err) {
      log.error("compact.render_error", { error: String(err) });
    }
  }

  /**
   * 경계(inFlight===null && compactionRequested && running)에 도달했으면 동기적으로 compacting
   * 진입 + 압축 비동기 kick. interval pump를 await로 막지 않아 동시 압축이 겹치지 않는다(BLOCKER 2).
   * 진입했으면 true.
   */
  function maybeStartCompaction(): boolean {
    if (!compactionRequested || inFlight || state !== "running") return false;
    compactionRequested = false;
    setState("compacting");
    applyCue("thinking");
    void runCompaction();
    return true;
  }

  /**
   * 압축 thunk를 timeout과 race하고(BLOCKER 3) 어떤 결과든 상태머신을 정착시킨다:
   * stopped가 아니면 running 복귀 + cue 해제 + pump 1회로 보류 이벤트 drain.
   * hung compact가 dispatcher를 영구 동결시키지 못한다.
   */
  async function runCompaction(): Promise<void> {
    const abort = new AbortController();
    compactAbort = abort;
    const compact = deps.compact!;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<void>((resolve) => {
      timeoutId = setTimeout(() => {
        abort.abort();
        resolve();
      }, compactTimeoutMs);
    });
    try {
      await Promise.race([compact(abort.signal).then(() => undefined), timeout]);
    } catch (err) {
      log.warn("compact.error", { error: String(err) });
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (compactAbort === abort) compactAbort = null;
      // stop()이 끼어들었으면 running으로 되돌리지 않는다.
      if (state !== "stopped") {
        applyCue("neutral");
        setState("running");
        pump();
      }
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
   * compacting 등 그 외 비-running이면 no-op으로 보류 이벤트를 잡아 둔다.
   */
  function pump(): void {
    if (state !== "running" && state !== "cooldown") return;
    // 이미 idle인데 압축이 래치돼 있으면 여기서 경계에 도달한다(running일 때만; cooldown이면 no-op, BLOCKER 2).
    if (maybeStartCompaction()) return;
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
      // compacting 중 start()는 rotation 중간에 running으로 되돌리지 않는다.
      if (state === "running" || state === "compacting") return;
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
      // 진행 중인 압축도 중단(설정 핸들러는 stopped를 보면 running 복귀를 건너뛴다).
      if (compactAbort) {
        compactAbort.abort();
        compactAbort = null;
      }
      compactionRequested = false;
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
    requestCompaction() {
      if (
        !deps.compact ||
        compactionRequested ||
        state === "compacting" ||
        state === "stopped" ||
        state === "booting"
      ) {
        return;
      }
      // 세션이 없으면 무의미한 압축 + cue flicker를 피한다.
      if (!deps.getSessionId?.()) return;
      compactionRequested = true;
      // 이미 idle이면 tick을 기다리지 않고 즉시 압축한다.
      maybeStartCompaction();
    },
    subscribeState(cb) {
      stateSubscribers.add(cb);
      return () => {
        stateSubscribers.delete(cb);
      };
    },
  };
}
