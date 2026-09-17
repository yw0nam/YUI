/** Tier-1 rendering: local directives, posture ledger, pin targets and the tap-emotion revert, with no backend involved. */
import type { PeekConfig, TapConfig } from "../../config/load";
import type { BodyState, Posture } from "../../contract";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { BusEnvelope } from "./event-bus";
import {
  isSitDrop,
  type PeekDropPayload,
  parsePeekDropPayload,
  samePosture,
  tier1Directive,
} from "./tier1-directive";

export interface Tier1RenderDeps {
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
  hasOutstandingSpeech: () => boolean;
  log: Logger;
}

export interface Tier1Render {
  render(env: BusEnvelope): void;
  getBodyState(): BodyState;
  /** The avatar moved on its own; posture returns to standing with a fresh stamp. */
  noteAvatarMoved(): void;
  /** Clears the pending tap-emotion revert. */
  dispose(): void;
}

export function createTier1Render(deps: Tier1RenderDeps): Tier1Render {
  const { renderer, log } = deps;

  // Pending tap-emotion revert — replaced per emotion tap, cleared on stop.
  let emotionRevertTimer: ReturnType<typeof setTimeout> | null = null;
  /** Whether the pat currently held applied an emotion — only then does its release revert one. */
  let patEmotionHeld = false;
  // Wall clock, not the frame clock — since keeps running while the window is hidden.
  let bodyState: BodyState = { posture: { state: "standing" }, since: Date.now() };
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
      if (deps.hasOutstandingSpeech()) return;
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
      isSitDrop(env.event_name) &&
      typeof env.payload?.edge_local_ypx === "number" &&
      Number.isFinite(env.payload.edge_local_ypx)
        ? env.payload.edge_local_ypx
        : null;
    if (env.event_name === "user.peek_drop" && !peekDrop) {
      log.warn("peek_drop.malformed", { seq_id: env.seq_id, payload: env.payload });
      return;
    }
    if (isSitDrop(env.event_name) && sitDropEdge === null) {
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
      // The pat emotion holds for the whole press — an earlier tap's revert would clip it,
      // and only the release eases back, and only what the pat itself applied.
      if (env.event_name === "user.pat_start") {
        clearTapEmotionRevert();
        patEmotionHeld = directive.emotion !== undefined;
      } else if (env.event_name === "user.pat_end") {
        if (patEmotionHeld) scheduleTapEmotionRevert();
        patEmotionHeld = false;
      } else if (env.event_name === "user.tap_region" && directive.emotion) {
        scheduleTapEmotionRevert();
      }
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
      case "avatar.window_sit":
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
      case "avatar.walk_start":
        next = { state: "walking" };
        break;
      case "avatar.climb_start":
        next = { state: "climbing" };
        break;
      case "user.window_sit_exit":
      case "user.peek_exit":
      case "user.drag_end":
      case "avatar.walk_end":
      case "avatar.climb_end":
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
              isSitDrop(env.event_name) ||
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
        env.event_name.startsWith("user.window_sit_") ||
        env.event_name === "avatar.window_sit"
      ) {
        renderer.setPeekTarget(null);
        renderer.setMotionMirror(false);
      }

      if (env.event_name === "user.window_sit_exit" || env.event_name === "user.drag_start") {
        renderer.setPerchTarget(null);
        return;
      }
      if (isSitDrop(env.event_name) && sitDropEdge !== null) {
        renderer.setPerchTarget({ edgeLocalYpx: sitDropEdge });
      }
    } catch (err) {
      log.error("tier1.pin_target_error", { error: String(err) });
    }
  }

  return {
    render: renderTier1,
    getBodyState() {
      return bodyState;
    },
    noteAvatarMoved() {
      bodyState = { posture: { state: "standing" }, since: Date.now() };
    },
    dispose: clearTapEmotionRevert,
  };
}
