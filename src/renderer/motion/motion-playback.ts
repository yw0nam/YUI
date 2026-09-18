/** Mixer-driven motion playback: controller decisions, action crossfade, finish → next, idle baseline. */
import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { MotionRegistry } from "../../contract";
import type { Logger } from "../../logger";
import type { VrmParticipant } from "../vrm-participant";
import type { ClipLibrary } from "./clip-library";
import { createCycleDwell } from "./cycle-dwell";
import {
  createMotionController,
  type MotionController,
  poolSelectionChanged,
  type RenderMotionSignal,
  type ResolvedMotion,
  shouldRestartIdle,
} from "./motion-controller";
import { resolveBaselineFallback } from "./motion-fallback";
import { createMotionStartGeneration } from "./motion-start-generation";
import { baselineWhileHeld, suppressWhileHeld } from "./perch-hold";

/** Ambient baseline pool id — the only pool whose variants the user selects. */
const IDLE_POOL_ID = "idle";

export interface MotionPlayback extends VrmParticipant {
  onVrmLoaded(vrm: VRM): void;
  onVrmDisposed(): void;
  step(ctx: { dt: number }): void;
  /** True while a non-baseline motion clip is actively playing. */
  isConverging(): boolean;
  playMotion(motion: RenderMotionSignal | null): void;
  current(): ResolvedMotion | null;
  /** Clip-local playhead (s) of the committed motion; null when the running action is not its own. */
  currentTime(): number | null;
  setRegistry(registry: MotionRegistry): void;
  setIdleVariants(paths: readonly string[]): void;
}

export function createMotionPlayback(deps: {
  clips: Pick<ClipLibrary, "load" | "playbackClip">;
  registry: MotionRegistry | undefined;
  /** "sitting" | "peeking" while a pin holds the posture, else null. */
  heldPosture: () => "sitting" | "peeking" | null;
  log: Pick<Logger, "debug" | "info" | "warn" | "error">;
}): MotionPlayback {
  const { log } = deps;

  let motionRegistry: MotionRegistry | undefined = deps.registry;
  /** User-selected ambient idle variants; null until the settings overlay is applied. */
  let idleVariants: readonly string[] | null = null;
  /** Every controller resolves the ambient pool through the live selection. */
  function newMotionController(registry: MotionRegistry): MotionController {
    return createMotionController(registry, {
      variantFilter: (id, variants) => {
        const enabled = idleVariants;
        if (id !== IDLE_POOL_ID || !enabled) return variants;
        return variants.filter((v) => enabled.includes(v));
      },
    });
  }
  let controller: MotionController | undefined = motionRegistry
    ? newMotionController(motionRegistry)
    : undefined;
  /** AnimationMixer for current VRM only (recreated on each hotswap). */
  let mixer: THREE.AnimationMixer | undefined;
  let vrm: VRM | undefined;
  /** Currently playing AnimationAction (prev in crossfade). */
  let currentAction: THREE.AnimationAction | undefined;
  let currentActionId: string | undefined;
  let lastStateMotionId: string | null = null;
  /** mixer "finished" event → AnimationAction → motion id reverse lookup. */
  const actionToId = new Map<THREE.AnimationAction, string>();
  const motionStartGeneration = createMotionStartGeneration();
  /** Scheduler for dwell (settling frame hold) before cycle motion variant swap — startMotion is cancel chokepoint. */
  const cycleDwell = createCycleDwell();

  /** mixer "finished" handler (oneshot end → controller.finish → return playback). */
  const onMixerFinished = (e: { action: THREE.AnimationAction }): void => {
    try {
      const id = actionToId.get(e.action);
      actionToId.delete(e.action);
      if (!controller || !id) return;
      // if cycle motion, hold settling final frame for cycle_dwell_ms then swap.
      const isCycle = controller.current()?.cycle ?? false;
      const dwell = motionRegistry?.[id]?.cycle_dwell_ms;
      const swap = (): void => {
        const decision = controller!.finish(id);
        controller!.commit(decision);
        if (decision.action === "play") {
          void startMotion(decision.motion);
        }
      };
      cycleDwell.onFinish(isCycle, dwell, swap);
    } catch (err) {
      log.error("motion_finish_handler_error", { error: String(err) });
    }
  };

  /**
   * Actually play resolved motion (load clip → compose action → crossfade).
   * controller.commit is performed by caller (playMotion/finish) with the decision.
   */
  async function startMotion(motion: ResolvedMotion): Promise<void> {
    const startToken = motionStartGeneration.begin();
    // Single play sink — cancel any pending dwell swap for new motion (prevents interrupt delay/stale swap).
    cycleDwell.cancel();
    if (!vrm || !mixer) return;
    try {
      let clip = await deps.clips.load(motion.vrma_path, motion.root_lock_y);
      if (!motionStartGeneration.isCurrent(startToken)) return;
      if (!clip) {
        // Real load failure (clip missing/invalid for the live VRM) → fall back to idle.
        // A hotswap/teardown drop (no vrm / no mixer) just returns silently.
        if (vrm && mixer) fallbackToBaseline(motion.id);
        return;
      }
      if (!mixer) return;

      log.debug("start_motion", { id: motion.id, vrma_path: motion.vrma_path });

      const fadeMs = Math.max(0, motion.fade_ms);
      const prev = currentAction;
      clip = deps.clips.playbackClip(clip, prev ? prev.getClip() : null, fadeMs);

      const action = mixer.clipAction(clip);
      action.timeScale = motion.speed;
      if (motion.loop && !motion.cycle) {
        // plain loop or single-variant pingpong (continuous).
        action.setLoop(motion.pingpong ? THREE.LoopPingPong : THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        // oneshot or cycle: if pingpong then after 2N reps, otherwise once then controller.finish via finished.
        action.setLoop(
          motion.pingpong ? THREE.LoopPingPong : THREE.LoopOnce,
          motion.pingpong ? motion.loop_reps : 1,
        );
        action.clampWhenFinished = true;
        actionToId.set(action, motion.id);
      }
      // The outgoing action keeps advancing during the fade and can still cross its own
      // clip end, dispatching a stale "finished" for it once a new motion has replaced it.
      if (prev && prev !== action) actionToId.delete(prev);

      const fade = fadeMs / 1000;
      action.reset();
      action.enabled = true;
      if (prev && prev !== action && fade > 0) {
        action.crossFadeFrom(prev, fade, false).play();
      } else {
        if (prev && prev !== action) prev.stop();
        if (fade > 0) action.fadeIn(fade);
        action.play();
      }
      currentAction = action;
      currentActionId = motion.id;
      if (motion.kind === "state") lastStateMotionId = motion.id;
    } catch (err) {
      log.error("start_motion", { error: String(err) });
      // Loader threw for the live VRM → recover to idle. Drops (hotswap/teardown) return silently.
      if (motionStartGeneration.isCurrent(startToken) && vrm && mixer) {
        fallbackToBaseline(motion.id);
      }
    }
  }

  /**
   * A motion's clip failed to load → repair controller state to idle and (re)play it.
   * playMotion commits before the async load, so a failed clip leaves current +
   * previousStable pinned at the dead id and a later idle blocked by priority;
   * force-committing idle (motion-fallback) overwrites both. Recursion guard: idle's
   * own failure resolves to null and no-ops. Honors public/purchased_motions/AGENTS.md.
   */
  function fallbackToBaseline(failedId: string): void {
    if (!controller) return;
    log.warn("motion_fallback_to_idle", { failed_id: failedId });
    const idle = resolveBaselineFallback(controller, failedId);
    if (idle) void startMotion(idle);
  }

  /** If registry exists, lay down baseline so ambient always plays. */
  function playIdleBaseline(): void {
    if (!controller) return;
    const held = deps.heldPosture() !== null;
    playMotion({ id: baselineWhileHeld(held, lastStateMotionId, controller.baseline()) });
  }

  /** playMotion implementation — request → (play/queue/ignore) → commit + actual playback. */
  function playMotion(motion: RenderMotionSignal | null): void {
    if (!controller) {
      log.warn("play_motion_no_registry");
      return;
    }
    if (!vrm || !mixer) return; // Playback not possible if VRM not loaded.
    const posture = deps.heldPosture();
    if (suppressWhileHeld(motion, posture !== null, (id) => motionRegistry?.[id]?.kind)) {
      if (motion) {
        log.info("motion_dropped_held_posture", {
          id: motion.id,
          posture,
        });
      }
      return;
    }
    try {
      const decision = controller.request(motion);
      controller.commit(decision);
      if (decision.action === "play") {
        void startMotion(decision.motion);
      }
      // "queue" is stored in slot via commit — drained on finish.
      // "ignore" is no-op.
    } catch (err) {
      log.error("play_motion", { error: String(err) });
    }
  }

  function setRegistry(registry: MotionRegistry): void {
    motionRegistry = registry;
    controller = newMotionController(registry);
    // If VRM is already loaded, immediately start idle baseline.
    if (vrm && mixer) playIdleBaseline();
  }

  function setIdleVariants(paths: readonly string[]): void {
    const previous = idleVariants;
    const next = [...paths];
    idleVariants = next;
    if (!poolSelectionChanged(previous, next)) return;
    // Nothing is playable before a VRM+mixer exist, so no motion can be stuck yet.
    const playing = vrm && mixer ? (controller?.current() ?? null) : null;
    if (shouldRestartIdle(previous, next, playing, IDLE_POOL_ID)) {
      // A pool of one loops without ever finishing — only a replay picks the change up.
      playIdleBaseline();
      return;
    }
    // Otherwise the change rides the next re-resolve. Drop the cached return target so a motion
    // playing over the pool cannot restore a resolution captured before the change.
    controller?.invalidatePool(IDLE_POOL_ID);
  }

  return {
    onVrmLoaded(next) {
      vrm = next;
      // New mixer for this VRM (clips are VRM-specific so start fresh).
      mixer = new THREE.AnimationMixer(next.scene);
      mixer.addEventListener("finished", onMixerFinished as never);
      playIdleBaseline(); // If registry exists, auto-play idle ambient.
    },
    onVrmDisposed() {
      cycleDwell.cancel(); // prevent stale swap on mixer being disposed.
      motionStartGeneration.invalidate();
      if (mixer) {
        mixer.removeEventListener("finished", onMixerFinished as never);
        mixer.stopAllAction();
        if (vrm) mixer.uncacheRoot(vrm.scene);
        mixer = undefined;
      }
      actionToId.clear();
      currentAction = undefined;
      currentActionId = undefined;
      // Controller has no simple no-op reset, so recreate to empty current/queue.
      // (Clips are VRM-specific so idle baseline must be replayed on next VRM anyway.)
      if (motionRegistry) controller = newMotionController(motionRegistry);
      vrm = undefined;
    },
    step(ctx) {
      if (mixer) {
        try {
          mixer.update(ctx.dt);
        } catch (err) {
          log.error("mixer_update_error", { error: String(err) });
        }
      }
    },
    isConverging(): boolean {
      if (!currentAction?.isRunning()) return false;
      const id = controller?.current()?.id;
      return id != null && id !== controller?.baseline();
    },
    playMotion,
    current() {
      return controller?.current() ?? null;
    },
    currentTime(): number | null {
      const current = controller?.current();
      if (!current || !currentAction || current.id !== currentActionId) return null;
      // A start is asynchronous, so the action can still be holding the previous clip.
      return currentAction.time;
    },
    setRegistry,
    setIdleVariants,
  };
}
