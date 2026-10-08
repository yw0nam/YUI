/**
 * The bed as the avatar commands see it: what phase the scene is in, the sequence that lays her
 * down at the spot she stands on, and getting her up. The scene runs the clips; this decides what
 * a command may do around it and what it answers.
 */
import type { BedScene } from "../../ambient/bed-scene/bed-scene";
import type { AvatarBed } from "../../io/bridge/inbox/avatar-executor";
import type { AvatarCommandResult, AvatarFailure } from "../../io/bridge/inbox/avatar-rpc";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { BedSceneHold } from "./bed-scene-hold";

type SceneRef = Pick<BedScene, "state" | "lieDown" | "wake" | "cancel" | "cancelStart">;

function fail(reason: AvatarFailure): AvatarCommandResult {
  return { ok: false, reason };
}

export function createAvatarBed(deps: {
  hold: BedSceneHold;
  /** null before the stage is wired and where no scene was built. */
  scene: () => SceneRef | null;
  /** False under reduced motion: no new scene may start. */
  canRun: () => boolean;
  /** Puts her on the floor where she stands; true when she is down. */
  place: () => Promise<boolean>;
  renderer: Pick<Renderer, "setPerchTarget" | "setPeekTarget" | "setMotionMirror">;
  log: Logger;
}): AvatarBed {
  const { hold, renderer, log } = deps;
  /** A lie-down is between its first step and its answer. */
  let starting = false;
  let interrupted = false;

  return {
    phase() {
      switch (deps.scene()?.state()) {
        case "starting":
          return "starting";
        case "asleep":
          return "lying";
        case "waking":
          return "waking";
        default:
          // A finished scene still holds the window until its exit has released it.
          if (hold.isHeld()) return "starting";
          return deps.scene() && deps.canRun() ? "off" : "unsupported";
      }
    },

    async lieDown() {
      const scene = deps.scene();
      if (!scene || !deps.canRun()) return fail("unsupported");
      // The perch pins clear a bus pump after the exit event; the lying-down clip would be
      // dropped as a held posture until then.
      renderer.setPerchTarget(null);
      renderer.setPeekTarget(null);
      renderer.setMotionMirror(false);
      hold.take();
      starting = true;
      interrupted = false;
      // Once the scene has the hold, its own exit lets go after the window is back to its size.
      let handedOver = false;
      try {
        const placed = await deps.place();
        if (interrupted) return fail("interrupted");
        if (!placed) return fail("busy");
        handedOver = true;
        const result = await scene.lieDown();
        if (result === "lying") return { ok: true };
        return fail(interrupted || result === "interrupted" ? "interrupted" : "unsupported");
      } catch (err) {
        log.warn("bed_lie_down_failed", { degrade: true, error: String(err) });
        return fail("unsupported");
      } finally {
        starting = false;
        if (!handedOver) hold.release();
      }
    },

    getUp() {
      const scene = deps.scene();
      if (scene?.state() === "asleep") scene.wake("agent");
      else if (scene?.state() === "starting") scene.cancel();
    },

    interrupt() {
      if (!starting) return;
      interrupted = true;
      deps.scene()?.cancelStart();
    },
  };
}
