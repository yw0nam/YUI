/** Push transport path of a turn: send the frame on the socket and hold the call open until that turn ends. */
import type { InputContext } from "../../contract";
import type { PushTurnFrame } from "../../io/chat/push/push-socket";
import type { Logger } from "../../logger";
import type { BusEnvelope } from "../core/event-bus";
import type { PushTurns } from "../turn/push-turn";
import type { Turn } from "../turn/turn";
import type { TurnOutput } from "../turn/turn-output";
import type { buildContext } from "./context-builder";
import { PRE_SPEECH_TIMEOUT_MS } from "./idle-watchdog";
import { contextBlock } from "./request-input";
import type { TurnOutcome } from "./turn-outcome";
import { recordSentTurn, type TurnRecordingDeps } from "./turn-recording";

/** The subset of `createBackendCaller`'s deps the push path reads. */
export interface PushCallDeps extends TurnRecordingDeps {
  /** B4 speech-gate outcome sink — whether the turn returned speech text, independent of TTS. */
  reportSpokeText?: (spoke: boolean) => void;
  /** Push transport sender — present in push mode; false means the socket was not ready. */
  pushTurn?: (frame: PushTurnFrame) => boolean;
  /** The socket accepted this turn's frame. */
  onPushTurnSent?: (turnId: string) => void;
  /** Push turn store — the call waits on it for the turn_end that closes its turn. */
  pushTurns?: Pick<PushTurns, "awaitTurnEnd" | "abandon">;
  /** Speech lifecycle port — the voice pipeline implements it. */
  turnOutput?: TurnOutput;
  /** Registers a callback for the push socket leaving `ready`; returns the unsubscribe. */
  onPushSocketNotReady?: (cb: () => void) => () => void;
}

export interface PushCallArgs {
  turn: Turn;
  env: BusEnvelope;
  ctx: InputContext;
  clientContext: Awaited<ReturnType<typeof buildContext>>["clientContext"];
  nowMs: number;
  startSessionToken: string | undefined;
  endThinking: () => void;
  externalSignal?: AbortSignal;
}

export interface PushCall {
  /** Sends the turn's frame and resolves when the turn ends, the user stops it, the budget expires, or the socket drops. */
  send(args: PushCallArgs): Promise<TurnOutcome>;
}

export function createPushCall(deps: PushCallDeps, log: Logger): PushCall {
  /**
   * How long a push turn runs: the frame is on the socket and the reply comes back as render
   * frames of its own, so the call stays open until that turn's `turn_end`. The wait also ends
   * when the user stops the reply, when the budget expires, when the socket leaves `ready`, or
   * when a newer turn supersedes this one. The budget restarts on every frame of the turn; a
   * render arriving after it expired still plays.
   *
   * Before the first render a budget expiry or a not-ready socket is a failure the dispatcher
   * speaks a line for; after it, the reply is already out, so the call settles `ok` on a log
   * line alone.
   */
  async function awaitPushReply(
    turn: Turn,
    eventName: string,
    endThinking: () => void,
    externalSignal?: AbortSignal,
  ): Promise<TurnOutcome> {
    const turnId = String(turn.id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    let onAbort: (() => void) | undefined;
    let firstRender = false;
    try {
      let stallExpired: ((value: "stall") => void) | undefined;
      const stall = new Promise<"stall">((resolve) => {
        stallExpired = resolve;
      });
      // The frame wait restarts on every frame carrying the turn's id.
      const armStall = (): void => {
        clearTimeout(timer);
        timer = setTimeout(() => stallExpired?.("stall"), PRE_SPEECH_TIMEOUT_MS);
      };
      armStall();
      const ends: Array<Promise<TurnOutcome>> = [
        stall.then(() => {
          if (firstRender) {
            log.warn("network_stall", {
              stage: "push_turn_end",
              event_name: eventName,
              turn_id: turnId,
            });
            return "ok";
          }
          return "network_stall";
        }),
        new Promise<TurnOutcome>((resolve) => {
          unsubscribe = deps.onPushSocketNotReady?.(() => {
            if (firstRender) {
              log.warn("network_drop", {
                stage: "push_turn_end",
                event_name: eventName,
                turn_id: turnId,
              });
              resolve("ok");
              return;
            }
            resolve("network_drop");
          });
        }),
      ];
      const turnEnd = deps.pushTurns?.awaitTurnEnd(turnId, {
        onFrame: armStall,
        onFirstRender: () => {
          firstRender = true;
          endThinking();
        },
        onToolStatus: (state, toolId) => deps.turnOutput?.toolStatus(turn.id, state, toolId),
      });
      ends.push(
        (turnEnd ?? new Promise<"cut">(() => {})).then((end) =>
          end === "ended" ? "ok" : "superseded_by_user",
        ),
      );
      if (externalSignal) {
        ends.push(
          new Promise<TurnOutcome>((resolve) => {
            onAbort = () => resolve("superseded_by_user");
            externalSignal.addEventListener("abort", onAbort, { once: true });
          }),
        );
      }
      const outcome = await Promise.race(ends);
      if (outcome === "network_stall" || outcome === "network_drop") {
        log.warn(outcome, { stage: "push_wait", event_name: eventName, turn_id: turnId });
      }
      return outcome;
    } finally {
      clearTimeout(timer);
      unsubscribe?.();
      if (onAbort) externalSignal?.removeEventListener("abort", onAbort);
      deps.pushTurns?.abandon(turnId);
    }
  }

  async function send({
    turn,
    env,
    ctx,
    clientContext,
    nowMs,
    startSessionToken,
    endThinking,
    externalSignal,
  }: PushCallArgs): Promise<TurnOutcome> {
    if (externalSignal?.aborted) return "superseded_by_user";
    const accepted = deps.pushTurn?.({
      turn_id: String(turn.id),
      client_context: contextBlock(clientContext, nowMs),
      text: ctx.user_text ?? "",
    });
    if (!accepted) {
      log.warn("network_drop", { stage: "push", event_name: env.event_name });
      return "network_drop";
    }
    deps.onPushTurnSent?.(String(turn.id));
    // The reply speaks from its own render frame, so this call never speaks.
    log.info("push_turn", { event_name: env.event_name, turn_id: String(turn.id) });
    deps.reportSpokeText?.(false);
    // The reply arrives on its own later and is appended there; this half is the user's.
    recordSentTurn(deps, log, {
      eventName: env.event_name,
      userText: ctx.user_text,
      clientContext,
      startSessionToken,
      spokeText: false,
      userHalfOnly: true,
    });
    if (externalSignal?.aborted) return "superseded_by_user";
    return await awaitPushReply(turn, env.event_name, endThinking, externalSignal);
  }

  return { send };
}
