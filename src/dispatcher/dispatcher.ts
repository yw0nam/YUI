/**
 * Dispatcher — the single router that enforces the firing≠judgment boundary.
 *
 * Flow:
 *  1. event_bus.pop() → classify → tier.
 *  2. evaluate via guardrails — user_input passes with dnd_override=true.
 *  3. conflict resolution: user.text_submitted arrives → abort in-flight backend +
 *     drop tier2/3 from the queue (superseded_by_user).
 *  4. Routing:
 *     · tier1 (drag/window/tap reactions, idle.returned) → local handling (no backend).
 *     · tier2/3 (user.text_submitted, idle.*, time_milestone.*) → backend_caller.
 *
 * Single in-flight backend call. Deferred tier2/3 keeps only one item in local pending
 * (with two or more deferred, the oldest is dropped).
 *
 * Every started turn anchors the global proactive gap. A fire from a paced source (loop cues,
 * schedule, signals, agent, screen) that arrives while that window holds is dropped as
 * global_gap before the guardrail sees it; gesture cues and user input pass ungated.
 *
 * state: booting → (start) → running → (stop) → stopped. cooldown polls the guardrails'
 *   overall-cap verdict every tick to transition running↔cooldown. degraded is entered when
 *   the backend call fails DEGRADED_FAILURE_THRESHOLD times in a row — during it, tier2/3
 *   (non-user) is dropped as degraded_drop, while user-initiated (dnd_override) turns keep
 *   going out to backend_caller without a gate (judgment belongs to the backend). A single
 *   successful call immediately returns to running and resets the consecutive-failure counter.
 * observable: queue() / recentDrops(n) / inFlight().
 */

import type { PeekConfig, TapConfig } from "../config/load";
import type { BodyState, ControlEnvelope, EmotionId, Posture } from "../contract";
import { buildPacerSkipRecord, type PacerSkipRecord } from "../io/turn-record-log";
import type { Logger, LogLevel } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import type { BackendCaller, TurnFailure, TurnOutcome } from "./backend-caller";
import type { BusEnvelope, EventBus } from "./event-bus";
import type { Guardrails } from "./guardrails";
import type { ProactivePacer } from "./proactive-pacer";
import type { TurnLog } from "./turn";

const baseLog = createLogger("dispatcher");

interface DispatcherDeps {
  bus: EventBus;
  renderer: Pick<
    Renderer,
    | "applyDirective"
    | "setPerchTarget"
    | "setPeekTarget"
    | "setMotionMirror"
    | "easeEmotionToNeutral"
  >;
  peekConfig: () => PeekConfig;
  /** Tap knobs — touch_emotion_hold_ms drives the tap-emotion revert timer. */
  tapConfig: () => TapConfig;
  peek?: { enter(): Promise<void>; exit(): Promise<void> };
  backendCaller: BackendCaller;
  /** Guardrails — debounce/rate-limit gate + cooldown verdict (pure). */
  guardrails: Guardrails;
  /** Turn identity + admission ledger. The dispatcher begins/settles turns on it and reads busy/audio-owed state from it. */
  turnLog: TurnLog;
  /**
   * Global proactive gap. Every turn start anchors its window; a fire from a paced source
   * (see PACED_SOURCES) that arrives while it holds is dropped at the routing gate, before the
   * guardrail. The screen source also gates itself, to record the skip with its transition; for
   * loop cues, schedule and the buffered inboxes this is the only gate.
   */
  pacer?: Pick<ProactivePacer, "isHolding" | "noteTurnStart">;
  /** Skip-record JSONL sink — best-effort disk log of the fires the pacer held back. */
  appendSkipRecord?: (record: PacerSkipRecord) => void;
  /** pump interval (ms). default 16 (roughly rAF). Tests advance with a fake timer. */
  pumpIntervalMs?: number;
  /**
   * Report a backend call failure of a user-initiated turn (user.text_submitted /
   * user.voice_segment_ready) along with its source (which trigger it was) —
   * superseded_by_user is excluded since it is not an error.
   * main.ts wires this to the UI error surface (showInputError / voice-input-indicator).
   * proactive/schedule/agent turn failures are only logged and never surface here (silent by design).
   */
  onUserTurnFailed?: (
    reason: Exclude<TurnFailure, "superseded_by_user">,
    source: UserTurnSource,
  ) => void;
  /** Structured logging (defaults to the dispatcher namespace logger). */
  logger?: Logger;
}

type DispatcherState = "booting" | "running" | "cooldown" | "degraded" | "draining" | "stopped";

/** recent_drops entry. */
export interface DropRecord {
  seq_id?: number;
  event_name: string;
  reason: TurnFailure | "guardrail_drop" | "stale_pending" | "degraded_drop" | "global_gap";
  ts: number;
}

/** drop reason → log severity. Record forces a missing key to be a compile error. */
export const DROP_SEVERITY: Record<DropRecord["reason"], LogLevel> = {
  guardrail_drop: "info",
  not_configured: "warn",
  parse_error: "warn",
  network_drop: "warn",
  network_stall: "warn",
  http_4xx_drop: "error",
  superseded_by_user: "info",
  stale_pending: "info",
  degraded_drop: "warn",
  global_gap: "info",
};

/** in_flight_backend_call. */
interface InFlightInfo {
  trigger: BusEnvelope;
  started_at: number;
}

export interface Dispatcher {
  state(): DispatcherState;
  /** Subscribe to sources + start the processing loop (booting → running). */
  start(): void;
  /** Stop the processing loop + abort in-flight → stopped. */
  stop(): void;
  /** Snapshot of the current deferred queue + unprocessed bus items. */
  queue(): BusEnvelope[];
  /** Most recent n drops (reason included). */
  recentDrops(n?: number): DropRecord[];
  /** In-progress backend call (null if none). */
  inFlight(): InFlightInfo | null;
  /** Current physical posture. `standing` is the free state. */
  getPosture(): Posture;
  /** Current posture with the wall-clock stamp of its change. */
  getBodyState(): BodyState;
  /** The avatar relocated on its own initiative (move_to) — restamps posture to standing/now. */
  noteAvatarMoved(): void;
  /** Abort the in-progress call + drop deferred tier2/3 (client-only). Does not sweep the bus or touch tier1. */
  cancel(): void;
  /** Subscribe to state transitions. Callback runs on every transition; returns an unsubscribe fn. */
  subscribeState(cb: (s: DispatcherState) => void): () => void;
  /** Subscribe to busy (= in-flight presence) transitions. Runs only at the idle⟷busy boundary; returns an unsubscribe fn. */
  subscribeBusy(cb: (busy: boolean) => void): () => void;
  /** Whether the pipeline is busy — in-flight call OR speech still playing. Separate from subscribeBusy (in-flight-only). */
  isPipelineBusy(): boolean;
  /** Subscribe to pipeline-busy transitions (in-flight OR speaking). Fires only at the idle⟷busy boundary; returns an unsubscribe fn. */
  subscribePipelineBusy(cb: (busy: boolean) => void): () => void;
}

type Tier = 1 | 2 | 3;
type Target = "tier1" | "backend_caller" | "drop";

interface Classification {
  tier: Tier;
  target: Target;
}

/**
 * classify. Only handled events are routed; the rest are dropped (= no-op).
 * Tap reactions are handled as tier1 local events.
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
  if (n.startsWith("agent.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (n.startsWith("signals.")) {
    return { tier: 2, target: "backend_caller" };
  }
  if (
    n === "user.drag_start" ||
    n === "user.drag_end" ||
    n === "idle.returned" ||
    n === "user.tap" ||
    n === "user.tap_region" ||
    n === "user.window_sit_enter" ||
    n === "user.window_sit_exit" ||
    n === "user.window_sit_drop" ||
    n === "user.peek_drop" ||
    n === "user.peek_exit"
  ) {
    return { tier: 1, target: "tier1" };
  }
  return { tier: (env.hint_tier ?? 3) as Tier, target: "drop" };
}

function samePosture(a: Posture, b: Posture): boolean {
  return (
    a.state === b.state &&
    a.perched_on?.app === b.perched_on?.app &&
    a.perched_on?.window_title === b.perched_on?.window_title
  );
}

/** Source of a user-initiated turn (typed vs voice) — filters onUserTurnFailed targets and hints routing.
 * Other triggers such as proactive/schedule/agent are undefined (§274, not a UI error-surface target). */
export type UserTurnSource = "text" | "voice";

function userTurnSourceOf(env: BusEnvelope): UserTurnSource | undefined {
  if (env.event_name === "user.text_submitted") return "text";
  if (env.event_name === "user.voice_segment_ready") return "voice";
  return undefined;
}

/**
 * tier1 event → render directive mapping (local, backend-independent).
 *  - drag_start → play motion "drag" / drag_end → return to idle (motion null).
 *  - user.tap → observability only; tap_region → payload motion.
 *  - idle.returned → empty directive (hold).
 * Returning null means no render.
 */
function tier1Directive(env: BusEnvelope, log: Logger): ControlEnvelope | null {
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
    case "user.peek_drop":
      return { speech_text: "", motion: { id: "peek" } };
    case "user.peek_exit":
      return { speech_text: "", motion: null };
    case "user.tap":
      return null;
    case "user.tap_region": {
      const motionId = env.payload?.motion_id;
      if (typeof motionId !== "string" || motionId.length === 0) {
        log.warn("tap_motion.malformed", { seq_id: env.seq_id, payload: env.payload });
        return null;
      }
      // emotion is enrichment, motion is primary — a malformed emotion_id degrades to motion-only.
      const emotionId = env.payload?.emotion_id;
      return {
        speech_text: "",
        motion: { id: motionId },
        ...(typeof emotionId === "string" && emotionId.length > 0
          ? { emotion: { id: emotionId as EmotionId } }
          : {}),
      };
    }
    case "idle.returned":
      // empty directive (emotion/motion unset = hold).
      return { speech_text: "" };
    default:
      return null;
  }
}

interface PeekDropPayload {
  side: "left" | "right";
  targetLocalXpx: number;
}

function parsePeekDropPayload(env: BusEnvelope): PeekDropPayload | null {
  const side = env.payload?.side;
  const targetLocalXpx = env.payload?.target_local_xpx;
  if (
    (side !== "left" && side !== "right") ||
    typeof targetLocalXpx !== "number" ||
    !Number.isFinite(targetLocalXpx)
  ) {
    return null;
  }
  return { side, targetLocalXpx };
}

/**
 * Which sources the global proactive gap applies to. Loop cues, schedule and the buffered
 * inboxes (signals, agent) all push as timer_scheduler, screen transitions as screen_watcher;
 * gesture cues and typed/spoken input are the user's own doing and pass ungated. Record forces
 * a new source value to answer paced-or-not at compile time.
 */
const PACED_SOURCES: Record<BusEnvelope["source"], boolean> = {
  timer_scheduler: true,
  screen_watcher: true,
  os_event_watcher: false,
  user_input_source: false,
  idle_watcher: false,
  backend_push_source: false,
};

const DEFAULT_PUMP_MS = 16;
const MAX_DROP_RECORDS = 50;
/** Consecutive backend call failure count — degraded is entered on reaching it. */
const DEGRADED_FAILURE_THRESHOLD = 3;

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { bus, renderer, backendCaller, guardrails } = deps;
  const pumpMs = deps.pumpIntervalMs ?? DEFAULT_PUMP_MS;
  const log = deps.logger ?? baseLog;

  let state: DispatcherState = "booting";
  let timer: ReturnType<typeof setInterval> | null = null;

  // Single in-flight backend call (only one; the rest are deferred).
  let inFlight: { trigger: BusEnvelope; started_at: number; abort: AbortController } | null = null;
  // Deferred tier2/3 (with two or more, the oldest is dropped).
  const pending: BusEnvelope[] = [];
  const drops: DropRecord[] = [];
  /** The turn whose summary line has not been emitted yet. */
  let openTurn: {
    id: number;
    trigger: string;
    started_at: number;
    outcome: TurnOutcome | null;
  } | null = null;
  // Consecutive backend call failure counter — superseded_by_user does not count as a failure.
  let consecutiveFailures = 0;
  // Pending tap-emotion revert — replaced per emotion tap, cleared on stop.
  let emotionRevertTimer: ReturnType<typeof setTimeout> | null = null;
  // Wall clock, not the frame clock — since keeps running while the window is hidden.
  let bodyState: BodyState = { posture: { state: "standing" }, since: Date.now() };

  const stateSubscribers = new Set<(s: DispatcherState) => void>();
  const busySubscribers = new Set<(busy: boolean) => void>();

  /** Pipeline-busy = the ledger has a live turn (in flight, or settled with audio still owed). */
  function currentPipelineBusy(): boolean {
    return !deps.turnLog.isOver();
  }

  /**
   * Emit the open turn's summary line, once. Must run before turnLog.begin() retires the
   * turn — `spoke`/`spoke_text` are read from the ledger, and begin() resets them.
   */
  function closeTurn(): void {
    if (!openTurn) return;
    log.info("turn", {
      id: openTurn.id,
      trigger: openTurn.trigger,
      // A turn still open when the next one begins was displaced; the only way its call had not
      // yet resolved is an abort.
      outcome: openTurn.outcome ?? "superseded_by_user",
      duration_ms: Date.now() - openTurn.started_at,
      spoke: deps.turnLog.didOweAudio(),
      spoke_text: deps.turnLog.didSpeakText(),
    });
    openTurn = null;
  }

  // Close the turn line at the over⟷live boundary — covers a turn that settles and finishes
  // owing audio without being displaced by the next begin() (see startBackendCall for that case).
  deps.turnLog.subscribe((over) => {
    if (over) closeTurn();
  });

  /** Single path for state transitions: assign + state_change log + notify subscribers. */
  function setState(next: DispatcherState): void {
    if (next === state) return;
    const from = state;
    state = next;
    log.info("state_change", { from, to: next });
    for (const cb of stateSubscribers) cb(next);
  }

  /** Single path for in-flight assignment: notify subscribers only at the idle⟷busy boundary (null↔non-null). */
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

  /** Whether the global proactive gap holds this fire back. */
  function heldByPacer(env: BusEnvelope): boolean {
    return PACED_SOURCES[env.source] && deps.pacer?.isHolding() === true;
  }

  function dropForPacer(env: BusEnvelope): void {
    recordDrop(env, "global_gap");
    try {
      deps.appendSkipRecord?.(buildPacerSkipRecord({ ts: env.ts, event_name: env.event_name }));
    } catch (err) {
      log.debug("skip_record_append_failed", { error: String(err) });
    }
  }

  /** Backend call success: reset the consecutive-failure counter + return immediately if degraded. */
  function noteCallSuccess(): void {
    consecutiveFailures = 0;
    if (state === "degraded") setState("running");
  }

  /** Backend call failure (excluding superseded_by_user): enter degraded on reaching the threshold. */
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
   * user.text_submitted arrives → abort in-flight + drop all deferred tier2/3 +
   * sweep and drop any tier2/3 still left in the bus. tier1 is processed immediately and kept.
   * (Since the bus is a priority queue where user pops first, this also clears trailing tier2/3
   * from the same pump here.)
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
    // Sweep tier2/3 left in the bus: drop what would go to the backend, render tier1 immediately to preserve it.
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

  /** Start a tier2/3 backend call (occupies in-flight). On completion, free the slot and drain one deferred item. */
  function startBackendCall(env: BusEnvelope): void {
    deps.pacer?.noteTurnStart();
    const abort = new AbortController();
    const started_at = Date.now();
    setInFlight({ trigger: env, started_at, abort });
    log.debug("backend_call", { trigger: env.event_name, seq_id: env.seq_id, started_at });
    closeTurn();
    const turn = deps.turnLog.begin(env);
    openTurn = { id: turn.id, trigger: env.event_name, started_at, outcome: null };
    void backendCaller
      .call(turn, abort.signal)
      .then((outcome) => {
        if (openTurn?.id === turn.id) openTurn.outcome = outcome;
        if (outcome === "ok") {
          noteCallSuccess();
          return;
        }
        if (outcome === "superseded_by_user") return;
        recordDrop(env, outcome);
        noteCallFailure();
        const source = userTurnSourceOf(env);
        if (source) deps.onUserTurnFailed?.(outcome, source);
      })
      .catch((err) => {
        if (openTurn?.id === turn.id) openTurn.outcome = "network_drop";
        log.error("backend_call.unexpected_error", { error: String(err) });
        recordDrop(env, "network_drop");
        noteCallFailure();
        const source = userTurnSourceOf(env);
        if (source) deps.onUserTurnFailed?.("network_drop", source);
      })
      .finally(() => {
        // Release the slot only if this call is still the current in-flight (leave it if replaced by an abort).
        // If there is a deferred item to drain right away, replace with the next call instead of freeing the slot,
        // keeping busy at true→true (no boundary notification).
        if (inFlight && inFlight.trigger === env) {
          if (canDrain()) {
            if (shouldHoldForPlayback(pending[0]!)) {
              // Playing — free the slot only and keep pending. pump drains it after playback ends.
              setInFlight(null);
            } else {
              startBackendCall(pending.shift()!);
            }
          } else if (state === "degraded" && pending.length > 0) {
            // Non-user turn already deferred at the moment degraded was entered — stale, so drop.
            recordDrop(pending.shift()!, "degraded_drop");
            setInFlight(null);
          } else {
            setInFlight(null);
          }
        }
        // Settle last: a successor's begin() (if drained above) already replaced the current
        // turn, so this hits the ledger's staleness guard instead of firing a spurious edge.
        deps.turnLog.settle(turn.id);
      });
  }

  /**
   * Whether one deferred item can now start as the next call (used to decide slot replacement right after a call completes).
   * During degraded, only user turns (dnd_override) drain — everything else is a drop target (handled in the finally above).
   */
  function canDrain(): boolean {
    if (pending.length === 0) return false;
    if (state === "running") return true;
    if (state === "degraded") return pending[0]?.dnd_override === true;
    return false;
  }

  /** Hold a non-user pending turn while playback is ongoing (user supersede is immediate). */
  function shouldHoldForPlayback(head: BusEnvelope): boolean {
    return userTurnSourceOf(head) === undefined && deps.turnLog.isAudioOwed();
  }

  /** tier2/3 enqueue: start immediately if in-flight is empty, otherwise defer (with two or more, drop the oldest). */
  function enqueueBackend(env: BusEnvelope): void {
    if (!inFlight && pending.length === 0 && !shouldHoldForPlayback(env)) {
      startBackendCall(env);
      return;
    }
    pending.push(env);
    // With two or more deferred, drop the oldest (stale).
    while (pending.length > 1) {
      recordDrop(pending.shift()!, "stale_pending");
    }
  }

  /**
   * Ease a locally applied tap emotion back to neutral after the hold —
   * a silent backend turn never triggers the playback-end revert, so without
   * this the face would stay on the tap emotion indefinitely.
   */
  function scheduleTapEmotionRevert(): void {
    if (emotionRevertTimer !== null) clearTimeout(emotionRevertTimer);
    // While speech is playing, the TTS cue path owns the expression; playback end/interrupt/abort each ease it to neutral.
    emotionRevertTimer = setTimeout(() => {
      emotionRevertTimer = null;
      if (deps.turnLog.isAudioOwed()) return;
      renderer.easeEmotionToNeutral();
    }, deps.tapConfig().touch_emotion_hold_ms);
  }

  function clearTapEmotionRevert(): void {
    if (emotionRevertTimer === null) return;
    clearTimeout(emotionRevertTimer);
    emotionRevertTimer = null;
  }

  /** tier1 event → renderer.applyDirective (local, backend-independent). */
  function renderTier1(env: BusEnvelope): void {
    const peekDrop = env.event_name === "user.peek_drop" ? parsePeekDropPayload(env) : null;
    const sitDropEdge =
      env.event_name === "user.window_sit_drop" &&
      typeof env.payload?.edge_local_ypx === "number" &&
      Number.isFinite(env.payload.edge_local_ypx)
        ? env.payload.edge_local_ypx
        : null;
    if (env.event_name === "user.peek_drop" && !peekDrop) {
      log.warn("peek_drop.malformed", { seq_id: env.seq_id, payload: env.payload });
      return;
    }
    if (env.event_name === "user.window_sit_drop" && sitDropEdge === null) {
      log.warn("perch_target.malformed", { seq_id: env.seq_id, payload: env.payload });
      return;
    }
    updatePosture(env);
    const directive = tier1Directive(env, log);
    if (!directive) return;
    log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier: 1 });
    applyPinTargets(env, peekDrop, sitDropEdge);
    applyPeekState(env);
    try {
      renderer.applyDirective(directive);
      if (env.event_name === "user.tap_region" && directive.emotion) scheduleTapEmotionRevert();
    } catch (err) {
      log.error("tier1.render_error", { error: String(err) });
    }
  }

  function updatePosture(env: BusEnvelope): void {
    const app = env.payload?.app;
    const windowTitle = env.payload?.window_title;
    const perched_on =
      typeof app === "string" || typeof windowTitle === "string"
        ? {
            ...(typeof app === "string" ? { app } : {}),
            ...(typeof windowTitle === "string" ? { window_title: windowTitle } : {}),
          }
        : undefined;
    let next: Posture;
    switch (env.event_name) {
      case "user.window_sit_drop":
        next = { state: "sitting", ...(perched_on ? { perched_on } : {}) };
        break;
      case "user.window_sit_enter":
        next = { state: "sitting" };
        break;
      case "user.peek_drop":
        next = { state: "peeking", ...(perched_on ? { perched_on } : {}) };
        break;
      case "user.drag_start":
        next = { state: "dragging" };
        break;
      case "user.window_sit_exit":
      case "user.peek_exit":
      case "user.drag_end":
        next = { state: "standing" };
        break;
      default:
        return;
    }
    // Re-affirming the posture already held is not a change — `since` keeps its original stamp.
    if (samePosture(bodyState.posture, next)) return;
    bodyState = { posture: next, since: Date.now() };
  }

  function applyPeekState(env: BusEnvelope): void {
    if (!deps.peek) return;
    try {
      const operation =
        env.event_name === "user.peek_drop"
          ? deps.peek.enter()
          : env.event_name === "user.peek_exit" ||
              env.event_name === "user.drag_start" ||
              env.event_name === "user.window_sit_drop" ||
              env.event_name === "user.window_sit_enter"
            ? deps.peek.exit()
            : null;
      void operation?.catch((err) => log.error("tier1.peek_state_error", { error: String(err) }));
    } catch (err) {
      log.error("tier1.peek_state_error", { error: String(err) });
    }
  }

  function applyPinTargets(
    env: BusEnvelope,
    peekDrop: PeekDropPayload | null,
    sitDropEdge: number | null,
  ): void {
    try {
      if (peekDrop) {
        renderer.setPerchTarget(null);
        renderer.setMotionMirror(peekDrop.side === deps.peekConfig().mirror_side);
        renderer.setPeekTarget({ targetXpx: peekDrop.targetLocalXpx });
        return;
      }

      if (
        env.event_name === "user.peek_exit" ||
        env.event_name === "user.drag_start" ||
        env.event_name.startsWith("user.window_sit_")
      ) {
        renderer.setPeekTarget(null);
        renderer.setMotionMirror(false);
      }

      if (env.event_name === "user.window_sit_exit" || env.event_name === "user.drag_start") {
        renderer.setPerchTarget(null);
        return;
      }
      if (env.event_name === "user.window_sit_drop" && sitDropEdge !== null) {
        renderer.setPerchTarget({ edgeLocalYpx: sitDropEdge });
      }
    } catch (err) {
      log.error("tier1.pin_target_error", { error: String(err) });
    }
  }

  /**
   * The dispatcher owns the running ↔ cooldown transition. Since the guardrail only returns a verdict
   * and takes no part in the transition, this polls cooldownActive() every tick to sync state (both entry and exit).
   */
  function syncCooldownState(): void {
    const inCooldown = guardrails.cooldownActive();
    if (inCooldown && state === "running") {
      setState("cooldown");
    } else if (!inCooldown && state === "cooldown") {
      setState("running");
    }
  }

  /** Start the held pending if it can start (retried on the next tick after playback ends). */
  function drainPending(): void {
    if (inFlight || !canDrain()) return;
    if (shouldHoldForPlayback(pending[0]!)) return;
    startBackendCall(pending.shift()!);
  }

  function handle(env: BusEnvelope): void {
    // For a user-initiated turn (typed or voice), apply supersede before classification.
    if (userTurnSourceOf(env) !== undefined) {
      supersedeByUser();
    }

    const { tier, target } = classify(env);
    if (target === "tier1") {
      // tier1 is never gated (independent of guardrails/cooldown).
      renderTier1(env);
      return;
    }
    if (target === "backend_caller") {
      // During degraded, drop non-user (not dnd_override) tier2/3 before gate —
      // keep passing user-initiated turns to delegate judgment to backend.
      if (state === "degraded" && env.dnd_override !== true) {
        recordDrop(env, "degraded_drop");
        return;
      }
      // Ahead of the guardrail: evaluate() spends a rate-limit slot at fire time and never
      // refunds it, so a held fire must not reach it.
      if (heldByPacer(env)) {
        dropForPacer(env);
        return;
      }
      // After classifying to get tier, evaluate. If drop, don't enqueue.
      const verdict = guardrails.evaluate(env, tier);
      if (!verdict.pass) {
        recordDrop(env, verdict.reason);
        return;
      }
      log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier });
      enqueueBackend(env);
      return;
    }
    // target === "drop": unhandled event (no-op — bus already filters unknown event_name).
  }

  /**
   * pump: drain bus every tick. Operates in running/cooldown/degraded all (tier1 always continues each).
   * Otherwise (booting/stopped/draining) hold pending events as no-op.
   */
  function pump(): void {
    if (state !== "running" && state !== "cooldown" && state !== "degraded") return;
    let env: BusEnvelope | null;
    while ((env = bus.pop()) !== null) {
      handle(env);
    }
    // Backend evaluation may have entered cooldown or timer may have expired → sync state.
    syncCooldownState();
    drainPending();
  }

  return {
    state() {
      return state;
    },
    start() {
      if (state === "running") return;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      setState("running");
      timer = setInterval(pump, pumpMs);
      // Drain once immediately (handle event pushed before first tick).
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
      clearTapEmotionRevert();
      setState("stopped");
    },
    queue() {
      // Expose combined pending + unprocessed bus snapshot.
      return [...pending, ...bus.snapshot()];
    },
    recentDrops(n = 10) {
      return drops.slice(-n);
    },
    inFlight() {
      return inFlight ? { trigger: inFlight.trigger, started_at: inFlight.started_at } : null;
    },
    getPosture() {
      return bodyState.posture;
    },
    getBodyState() {
      return bodyState;
    },
    noteAvatarMoved() {
      bodyState = { posture: { state: "standing" }, since: Date.now() };
    },
    cancel() {
      // client-only abort: abort in-flight call + drop pending. Don't do bus sweep/tier1 render.
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
    isPipelineBusy: currentPipelineBusy,
    subscribePipelineBusy(cb) {
      return deps.turnLog.subscribe((over) => cb(!over));
    },
  };
}
