/**
 * Dispatcher — the single router that enforces the firing≠judgment boundary.
 *
 * Flow:
 *  1. event_bus.pop() → classify → tier.
 *  2. guardrails.arrive — user_input passes with dnd_override=true; a debounce hit drops.
 *  3. conflict resolution: user.text_submitted arrives → abort in-flight backend; the aborted
 *     turn's members and the swept bus candidates return to the waiting list, and every waiting
 *     entry that does not expire on user activity rides the user's turn with the buffered signals.
 *  4. Routing:
 *     · tier1 (drag/window/tap/pat reactions, avatar.* gait cues, user.fall_land) → local
 *       handling (no backend).
 *     · tier2 user turns → backend_caller at once; signals.* fire if admissible now, else their
 *       groups return to the buffers; every other self-started candidate joins the waiting list.
 *
 * Single in-flight backend call. release() runs at the end of every pump tick and in a call's
 * finally: at a free slot it takes every admissible waiting entry (not held by do-not-disturb,
 * the proactive gap, absence or the hourly cap) and the drained batched signal groups as one turn.
 * With the turn gate on, a call first waits for the cross-window turn lock, which stays held until
 * the call has ended and its playback is done; the hourly slot is spent once the lock grants.
 *
 * state: booting → (start) → running → (stop) → stopped. degraded is entered when
 *   the backend call fails DEGRADED_FAILURE_THRESHOLD times in a row — during it, tier2
 *   (non-user) is dropped as degraded_drop, while user-initiated (dnd_override) turns keep
 *   going out to backend_caller without a gate (judgment belongs to the backend). A single
 *   successful call immediately returns to running and resets the consecutive-failure counter.
 * observable: queue() / waiting() / recentDrops(n) / inFlight().
 */

import type { PeekConfig, TapConfig } from "../config/validators/avatar/types";
import type { BodyState, Posture, SignalGroup } from "../contract";
import { buildPacerSkipRecord, type PacerSkipRecord } from "../io/chat/record/turn-record-log";
import type { Logger, LogLevel } from "../logger";
import { createLogger } from "../logger";
import type { Renderer } from "../renderer";
import type {
  BackendCaller,
  TurnErrorDetail,
  TurnFailure,
  TurnOutcome,
} from "./backend/backend-caller";
import { userTextOf } from "./backend/context-builder";
import type { AddressedChain } from "./core/addressed-chain";
import {
  classify,
  isAddressedEvent,
  isDndHeld,
  isUserActivity,
  PACED_SOURCES,
  sendIdOf,
  type UserTurnSource,
  userTurnSourceOf,
  type WaitClass,
} from "./core/classify";
import type { BusEnvelope, EventBus } from "./core/event-bus";
import type { Guardrails } from "./core/guardrails";
import type { ProactivePacer } from "./core/proactive-pacer";
import type { TurnGate } from "./core/turn-gate";
import { createWaitingList, type WaitingEntry } from "./core/waiting-list";
import { createTier1Render } from "./tier1/render";
import type { Turn, TurnLog } from "./turn/turn";

const baseLog = createLogger("dispatcher");

export interface DispatcherDeps {
  bus: EventBus;
  renderer: Pick<
    Renderer,
    | "applyDirective"
    | "setPerchTarget"
    | "setPeekTarget"
    | "setMotionMirror"
    | "easeEmotionToNeutral"
    | "getCurrentMotion"
  >;
  peekConfig: () => PeekConfig;
  /** Tap knobs — touch_emotion_hold_ms drives the tap-emotion revert timer. */
  tapConfig: () => TapConfig;
  peek?: { enter(): Promise<void>; exit(): Promise<void> };
  backendCaller: BackendCaller;
  /** Guardrails — debounce at arrival, the hourly cap at admission (pure). */
  guardrails: Guardrails;
  /** Turn identity + admission ledger. The dispatcher begins/settles turns on it and reads busy state from it. */
  turnLog: TurnLog;
  /** Whether the speech pipeline still owes audio — speech the backend started on its own included. */
  hasOutstandingSpeech: () => boolean;
  /**
   * Global proactive gap. Every turn start anchors its window; a candidate from a paced source
   * (see PACED_SOURCES) waits while it holds.
   */
  pacer?: Pick<ProactivePacer, "isHolding" | "noteTurnStart">;
  /** Whether do-not-disturb is on: holds every self-fired trigger in the waiting list and at the lock wait. */
  isDndOn?: () => boolean;
  /** Whether the user is present; absent counts as present. Gesture reactions and addressed lines do not wait for it. */
  isPresent?: () => boolean;
  /** Takes the deliverable batched signal groups out of their buffer. */
  drainSignals?: () => SignalGroup[];
  /** Returns an envelope's signal groups to their buffers. */
  restoreSignals?: (env: BusEnvelope) => void;
  /** A turn ended ok, reported with its trigger envelope. */
  onTurnSpoken?: (env: BusEnvelope) => void;
  /** Skip-record JSONL sink — best-effort disk log of the candidates the pacer held back. */
  appendSkipRecord?: (record: PacerSkipRecord) => void;
  /**
   * Report a backend call failure of a user-initiated turn (user.text_submitted /
   * user.voice_segment_ready) along with its source (which trigger it was) —
   * superseded_by_user is excluded since it is not an error. detail rides when the backend
   * answered the call with an HTTP error (status + bare server message).
   * main.ts wires this to the UI error surface (showInputError / the status pill's voice segment).
   * proactive/schedule turn failures are only logged and never surface here (silent by design).
   */
  onUserTurnFailed?: (
    reason: Exclude<TurnFailure, "superseded_by_user">,
    source: UserTurnSource,
    detail?: TurnErrorDetail,
  ) => void;
  /**
   * A backend call of any turn settled in a failure, reported with the turn it belonged to.
   * superseded_by_user returns early and never reaches this.
   */
  onTurnFailed?: (turn: Turn, reason: TurnFailure) => void;
  /** Cross-window turn lock: taken before a turn's backend call, released once the pipeline is idle again. */
  turnGate?: TurnGate;
  /** The dispatcher admitted a trigger: the turn it opened, reported before its backend call starts. */
  onTurnAdmitted?: (turn: Turn) => void;
  /** Every drop the dispatcher records, with its reason: a trigger held back or superseded before its backend call, or a backend call that failed. */
  onTurnDropped?: (env: BusEnvelope, reason: DropRecord["reason"]) => void;
  /** The chain cap on addressed turns: an over-cap fire drops at the routing gate or at release, an admitted one counts. */
  addressedChain: AddressedChain;
  /** A turn is over — the over edge, or the next begin displacing it — with the facts the `turn` log line holds. */
  onTurnClosed?: (turn: {
    id: number;
    outcome: TurnOutcome;
    spokeText: boolean;
    /** The unified chat window's send id when the turn answered a routed message. */
    sendId?: string;
    userText?: string;
  }) => void;
  /** Structured logging (defaults to the dispatcher namespace logger). */
  logger?: Logger;
}

type DispatcherState = "booting" | "running" | "degraded" | "stopped";

/** recent_drops entry. */
export interface DropRecord {
  seq_id?: number;
  event_name: string;
  reason:
    | TurnFailure
    | "guardrail_drop"
    | "degraded_drop"
    | "addressed_cap"
    | "waiting_evicted"
    | "waiting_expired";
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
  degraded_drop: "warn",
  addressed_cap: "info",
  waiting_evicted: "info",
  waiting_expired: "info",
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
  /** Snapshot of the waiting list + unprocessed bus items. */
  queue(): BusEnvelope[];
  /** The waiting entries in rank order. */
  waiting(): { id: string; env: BusEnvelope; cls: WaitClass }[];
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
  /** Abort the in-progress call (client-only) and end the on-activity waiting entries, as any user activity does. Does not sweep the bus or touch tier1. */
  cancel(): void;
  /** Subscribe to busy (= in-flight presence) transitions. Runs only at the idle⟷busy boundary; returns an unsubscribe fn. */
  subscribeBusy(cb: (busy: boolean) => void): () => void;
  /** Whether the pipeline is busy — in-flight call OR speech still playing. Separate from subscribeBusy (in-flight-only). */
  isPipelineBusy(): boolean;
  /** Subscribe to pipeline-busy transitions (in-flight OR speaking). Fires only at the idle⟷busy boundary; returns an unsubscribe fn. */
  subscribePipelineBusy(cb: (busy: boolean) => void): () => void;
}

const DEFAULT_PUMP_MS = 16;
const MAX_DROP_RECORDS = 50;
/** Consecutive backend call failure count — degraded is entered on reaching it. */
const DEGRADED_FAILURE_THRESHOLD = 3;

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
  const { bus, renderer, backendCaller, guardrails } = deps;
  const log = deps.logger ?? baseLog;

  let state: DispatcherState = "booting";
  let timer: ReturnType<typeof setInterval> | null = null;

  // Single in-flight backend call; its members are the waiting entries it carries.
  let inFlight: {
    trigger: BusEnvelope;
    members: WaitingEntry[];
    started_at: number;
    abort: AbortController;
  } | null = null;
  const list = createWaitingList();
  // Whether a lone signals.catchup could go out at the last release; groups alone leave only on its rising edge.
  let catchupFree = false;
  const drops: DropRecord[] = [];
  /** The turn whose summary line has not been emitted yet. */
  let openTurn: {
    id: number;
    trigger: string;
    started_at: number;
    outcome: TurnOutcome | null;
    sendId: string | undefined;
    userText: string | undefined;
  } | null = null;
  // A turn passed the gate; cleared when the pipeline goes idle.
  let gateHeld = false;
  // Consecutive backend call failure counter — superseded_by_user does not count as a failure.
  let consecutiveFailures = 0;
  const tier1 = createTier1Render({
    renderer,
    peekConfig: deps.peekConfig,
    tapConfig: deps.tapConfig,
    peek: deps.peek,
    hasOutstandingSpeech: deps.hasOutstandingSpeech,
    log,
  });

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
    const outcome = openTurn.outcome ?? "superseded_by_user";
    const spokeText = deps.turnLog.didSpeakText();
    log.info("turn", {
      id: openTurn.id,
      trigger: openTurn.trigger,
      // A turn still open when the next one begins was displaced; the only way its call had not
      // yet resolved is an abort.
      outcome,
      duration_ms: Date.now() - openTurn.started_at,
      spoke: deps.turnLog.didOweAudio(),
      spoke_text: spokeText,
    });
    const closed = {
      id: openTurn.id,
      outcome,
      spokeText,
      ...(openTurn.sendId ? { sendId: openTurn.sendId } : {}),
      ...(openTurn.userText !== undefined ? { userText: openTurn.userText } : {}),
    };
    openTurn = null;
    try {
      deps.onTurnClosed?.(closed);
    } catch (err) {
      log.warn("turn_hook_failed", { error: String(err) });
    }
  }

  // Close the turn line at the over⟷live boundary — covers a turn that settles and finishes
  // owing audio without being displaced by the next begin() (see startBackendCall for that case).
  deps.turnLog.subscribe((over) => {
    if (over) closeTurn();
  });

  /** Single path for state transitions: assign + state_change log. */
  function setState(next: DispatcherState): void {
    if (next === state) return;
    const from = state;
    state = next;
    log.info("state_change", { from, to: next });
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
    deps.onTurnDropped?.(env, reason);
  }

  /** Whether the global proactive gap holds this fire back. */
  function heldByPacer(env: BusEnvelope): boolean {
    return PACED_SOURCES[env.source] && deps.pacer?.isHolding() === true;
  }

  /** Whether do-not-disturb holds this fire back. */
  function heldByDnd(env: BusEnvelope): boolean {
    return deps.isDndOn?.() === true && isDndHeld(env);
  }

  /** Gesture reactions and addressed lines speak to her directly, so they do not wait for presence. */
  function heldByAbsence(env: BusEnvelope): boolean {
    const direct =
      env.source === "addressed_source" ||
      (env.source === "os_event_watcher" && env.event_name.startsWith("proactive."));
    return !direct && deps.isPresent?.() === false;
  }

  /** Whether a candidate may go out now, once the slot is free. */
  function admissible(env: BusEnvelope): boolean {
    return !heldByDnd(env) && !heldByPacer(env) && !heldByAbsence(env) && guardrails.canSpend(env);
  }

  const groupsOf = (env: BusEnvelope): SignalGroup[] =>
    Array.isArray(env.payload?.signals) ? (env.payload.signals as SignalGroup[]) : [];

  /** The envelope drained batched groups go out on when no waiting entry carries them. */
  const catchupOf = (signals: SignalGroup[]): BusEnvelope => ({
    source: "timer_scheduler",
    event_name: "signals.catchup",
    ts: Date.now(),
    payload: { signals },
  });

  function restoreGroups(groups: SignalGroup[]): void {
    if (groups.length > 0) deps.restoreSignals?.(catchupOf(groups));
  }

  /** A candidate joins the waiting list; its own signal groups go back to their buffers. */
  function enterList(env: BusEnvelope): void {
    const groups = groupsOf(env);
    let waiting = env;
    if (groups.length > 0) {
      restoreGroups(groups);
      const { signals: _carried, ...payload } = env.payload ?? {};
      waiting = { ...env, payload };
    }
    const { entry, evicted } = list.add(waiting);
    log.info("waiting_add", { id: entry.id, event_name: env.event_name, cls: entry.cls });
    for (const e of evicted) recordDrop(e.env, "waiting_evicted");
    if (!heldByPacer(env)) return;
    try {
      deps.appendSkipRecord?.(buildPacerSkipRecord({ ts: env.ts, event_name: env.event_name }));
    } catch (err) {
      log.debug("skip_record_append_failed", { error: String(err) });
    }
  }

  function expireOnActivity(): void {
    for (const e of list.expireOnActivity()) recordDrop(e.env, "waiting_expired");
  }

  /** Backend call success: reset the consecutive-failure counter + return immediately if degraded. */
  function noteCallSuccess(): void {
    consecutiveFailures = 0;
    if (state === "degraded") setState("running");
  }

  /** Backend call failure (excluding superseded_by_user): enter degraded on reaching the threshold. */
  function noteCallFailure(): void {
    consecutiveFailures += 1;
    if (consecutiveFailures >= DEGRADED_FAILURE_THRESHOLD && state === "running") {
      setState("degraded");
    }
  }

  /**
   * user.text_submitted arrives → abort in-flight; its members return to the waiting list and its
   * groups to the buffers. Tier2 left in the bus is swept the same way (a user envelope among it
   * drops as superseded); tier1 is rendered immediately. The bus pops user first, so this also
   * takes trailing tier2 from the same pump.
   */
  function supersedeByUser(): void {
    if (inFlight) {
      log.info("abort", { event_name: inFlight.trigger.event_name, reason: "superseded_by_user" });
      inFlight.abort.abort();
      list.putBack(inFlight.members);
      restoreGroups(groupsOf(inFlight.trigger));
      setInFlight(null);
    }
    let env: BusEnvelope | null;
    const tier1Leftover: BusEnvelope[] = [];
    while ((env = bus.pop()) !== null) {
      const { target } = classify(env);
      if (target === "tier1") tier1Leftover.push(env);
      else if (target !== "backend_caller") continue;
      else if (userTurnSourceOf(env)) recordDrop(env, "superseded_by_user");
      else if (env.event_name.startsWith("signals.")) deps.restoreSignals?.(env);
      else enterList(env);
    }
    for (const t of tier1Leftover) tier1.render(t);
  }

  /** Start a tier2 backend call (occupies in-flight). On completion, release the waiting list into the slot. */
  function startBackendCall(env: BusEnvelope, members: WaitingEntry[]): void {
    log.info("fire", { seq_id: env.seq_id, event_name: env.event_name, tier: 2 });
    deps.pacer?.noteTurnStart();
    const abort = new AbortController();
    const started_at = Date.now();
    setInFlight({ trigger: env, members, started_at, abort });
    log.debug("backend_call", { trigger: env.event_name, seq_id: env.seq_id, started_at });
    closeTurn();
    const turn = deps.turnLog.begin(env);
    openTurn = {
      id: turn.id,
      trigger: env.event_name,
      started_at,
      outcome: null,
      sendId: sendIdOf(env),
      userText: userTextOf(env),
    };
    deps.onTurnAdmitted?.(turn);
    // Server-side HTTP error detail, kept per call so a superseded turn's late detail
    // can never bleed into the next one.
    let errorDetail: TurnErrorDetail | undefined;
    const gate = deps.turnGate?.acquire(abort.signal) ?? Promise.resolve();
    void gate
      .then((): Promise<TurnOutcome> | TurnOutcome => {
        // An abort while the gate waited means the turn was superseded before it began.
        if (abort.signal.aborted) return "superseded_by_user";
        gateHeld = true;
        // Do-not-disturb turned on while the turn waited for the lock.
        const dndHeld =
          heldByDnd(env) || (env.dnd_override !== true && members.some((m) => heldByDnd(m.env)));
        if (dndHeld) return "dnd";
        guardrails.spend(env);
        // A user turn resets the chain, so the addressed lines riding it never count.
        if (userTurnSourceOf(env) === undefined) {
          for (const m of members) if (isAddressedEvent(m.env)) deps.addressedChain.count();
        }
        return backendCaller.call(turn, abort.signal, (detail) => {
          errorDetail = detail;
        });
      })
      .then((outcome) => {
        if (openTurn?.id === turn.id) openTurn.outcome = outcome;
        if (outcome === "ok") {
          noteCallSuccess();
          deps.onTurnSpoken?.(env);
          return;
        }
        if (outcome === "superseded_by_user") return;
        if (outcome === "dnd") {
          list.putBack(members);
          restoreGroups(groupsOf(env));
          return;
        }
        // signalsOf reads groups from only some tops, so the turn returns its own.
        restoreGroups(groupsOf(env));
        recordDrop(env, outcome);
        deps.onTurnFailed?.(turn, outcome);
        noteCallFailure();
        const source = userTurnSourceOf(env);
        if (source) deps.onUserTurnFailed?.(outcome, source, errorDetail);
      })
      .catch((err) => {
        if (openTurn?.id === turn.id) openTurn.outcome = "network_drop";
        log.error("backend_call.unexpected_error", { error: String(err) });
        restoreGroups(groupsOf(env));
        recordDrop(env, "network_drop");
        deps.onTurnFailed?.(turn, "network_drop");
        noteCallFailure();
        const source = userTurnSourceOf(env);
        if (source) deps.onUserTurnFailed?.("network_drop", source, errorDetail);
      })
      .finally(() => {
        // Only while this call is still the current in-flight (an abort may have replaced it).
        // A release that starts the next call replaces the slot, keeping busy at true→true.
        if (inFlight && inFlight.trigger === env && !release(true)) setInFlight(null);
        // Settle last: a successor's begin() (if released above) already replaced the current
        // turn, so this hits the ledger's staleness guard instead of firing a spurious edge.
        deps.turnLog.settle(turn.id);
      });
  }

  /**
   * Sends what may go out now as one turn: the admissible waiting entries (top-ranked envelope
   * plus `payload.waited`) and, unless do-not-disturb is on, the drained batched groups
   * (`payload.signals`). Groups alone go out as `signals.catchup` only on the edge into a free
   * slot (busy → idle, a DnD or gap hold ending, away → present); inside a free stretch they wait
   * for a bundle or the batch timer. `replacing` is the finishing call's finally, whose slot the
   * next call takes over.
   */
  function release(replacing = false): boolean {
    for (const e of list.expire(Date.now())) recordDrop(e.env, "waiting_expired");
    const slotFree =
      (!inFlight || replacing) && state === "running" && !deps.hasOutstandingSpeech();
    const wasFree = catchupFree;
    catchupFree = slotFree && admissible(catchupOf([]));
    if (!slotFree) return false;
    // Addressed entries taken here count toward the chain before the lock grants and counts them.
    let addressed = 0;
    const members = list.take((w) => {
      if (!admissible(w.env)) return false;
      if (!isAddressedEvent(w.env)) return true;
      if (!deps.addressedChain.canAdmit(addressed)) return false;
      addressed += 1;
      return true;
    });
    const overCap = (w: WaitingEntry) =>
      isAddressedEvent(w.env) && !deps.addressedChain.canAdmit(addressed);
    for (const e of list.take(overCap)) recordDrop(e.env, "addressed_cap");
    const free = members.length > 0 ? deps.isDndOn?.() !== true : catchupFree && !wasFree;
    const groups = free ? (deps.drainSignals?.() ?? []) : [];
    if (members.length === 0 && groups.length === 0) return false;
    log.info("waiting_release", { ids: members.map((m) => m.id), signals: groups.length });
    const [top, ...rest] = members;
    const trigger = !top
      ? catchupOf(groups)
      : rest.length === 0 && groups.length === 0
        ? top.env
        : {
            ...top.env,
            payload: {
              ...top.env.payload,
              waited: rest.map((m) => m.env),
              ...(groups.length > 0 ? { signals: groups } : {}),
            },
          };
    // The next call asks for the lock again, behind any window already waiting for it.
    if (replacing) releaseGate();
    startBackendCall(trigger, members);
    return true;
  }

  /** A user turn carries every waiting entry and the buffered batched groups. */
  function startUserTurn(env: BusEnvelope): void {
    const riders = list.take(() => true);
    const groups = deps.drainSignals?.() ?? [];
    const trigger =
      riders.length === 0 && groups.length === 0
        ? env
        : {
            ...env,
            payload: {
              ...env.payload,
              ...(riders.length > 0 ? { waited: riders.map((r) => r.env) } : {}),
              ...(groups.length > 0 ? { signals: groups } : {}),
            },
          };
    startBackendCall(trigger, riders);
  }

  function handle(env: BusEnvelope): void {
    // For a user-initiated turn (typed or voice), apply supersede before classification.
    if (userTurnSourceOf(env) !== undefined) {
      supersedeByUser();
      deps.addressedChain.reset();
    }
    if (isUserActivity(env)) expireOnActivity();

    const classified = classify(env);
    if (classified.target === "tier1") {
      // tier1 is never gated (independent of guardrails).
      tier1.render(env);
      return;
    }
    if (classified.target === "backend_caller") {
      // During degraded, drop non-user (not dnd_override) tier2 before gate —
      // keep passing user-initiated turns to delegate judgment to backend.
      if (state === "degraded" && env.dnd_override !== true) {
        recordDrop(env, "degraded_drop");
        return;
      }
      if (isAddressedEvent(env) && !deps.addressedChain.canAdmit()) {
        recordDrop(env, "addressed_cap");
        return;
      }
      const verdict = guardrails.arrive(env);
      if (!verdict.pass) {
        recordDrop(env, verdict.reason);
        return;
      }
      if (userTurnSourceOf(env) !== undefined) startUserTurn(env);
      else if (!env.event_name.startsWith("signals.")) enterList(env);
      else if (
        !inFlight &&
        state === "running" &&
        !deps.hasOutstandingSpeech() &&
        admissible(env)
      ) {
        startBackendCall(env, []);
      } else deps.restoreSignals?.(env);
      return;
    }
    // target === "drop": unhandled event (no-op — bus already filters unknown event_name).
  }

  function releaseGate(): void {
    if (!gateHeld) return;
    gateHeld = false;
    deps.turnGate?.release();
  }

  /**
   * pump: drain bus every tick. Runs in running and degraded; tier1 renders in both.
   * Otherwise (booting/stopped) hold pending events as no-op.
   */
  function pump(): void {
    if (state !== "running" && state !== "degraded") return;
    // Before the bus: a turn popped now asks for the lock again, behind any window already waiting.
    if (!currentPipelineBusy()) releaseGate();
    let env: BusEnvelope | null;
    while ((env = bus.pop()) !== null) {
      handle(env);
    }
    release();
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
      timer = setInterval(pump, DEFAULT_PUMP_MS);
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
      releaseGate();
      tier1.dispose();
      setState("stopped");
    },
    queue() {
      return [...list.snapshot().map((e) => e.env), ...bus.snapshot()];
    },
    waiting() {
      return list.snapshot().map(({ id, env, cls }) => ({ id, env, cls }));
    },
    recentDrops(n = 10) {
      return drops.slice(-n);
    },
    inFlight() {
      return inFlight ? { trigger: inFlight.trigger, started_at: inFlight.started_at } : null;
    },
    getPosture() {
      return tier1.getBodyState().posture;
    },
    getBodyState() {
      return tier1.getBodyState();
    },
    noteAvatarMoved() {
      tier1.noteAvatarMoved();
    },
    cancel() {
      // client-only abort: the turn's groups go back, its members do not. Don't do bus sweep/tier1 render.
      if (inFlight) {
        restoreGroups(groupsOf(inFlight.trigger));
        log.info("abort", {
          event_name: inFlight.trigger.event_name,
          reason: "superseded_by_user",
        });
        inFlight.abort.abort();
        setInFlight(null);
      }
      expireOnActivity();
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
