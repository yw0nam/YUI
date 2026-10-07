/** Wires the stage's pointer gestures: taps, pats, the drag and the camera orbit. */
import type { AppConfig } from "../../config/load";
import type { SignalGroup } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import { createDragHoldSource } from "../../dispatcher/sources/gesture/drag-hold-source";
import { createTapSource, type TapSource } from "../../dispatcher/sources/gesture/tap-source";
import type { PatGesture } from "../../io/window/pet/gesture/click-gesture";
import { initDrag } from "../../io/window/pet/gesture/window-drag";
import type { HitTestController } from "../../io/window/pet/hit-test";
import type { Renderer } from "../../renderer";
import { orbitCamera } from "../../settings/avatar/camera-gestures";
import type { createCameraSettings } from "../../settings/avatar/camera-settings";
import type { wireLocomotion } from "./wire-locomotion";

/**
 * Head-pat gesture wiring. The press holds the button and moves without starting an OS drag,
 * so the click-through hit-test stays suspended for its whole length — otherwise a move over a
 * transparent pixel flips the window to passthrough and the release never reaches the client.
 */
export function createPatGesture(deps: {
  hitTest: Pick<HitTestController, "suspend" | "resume">;
  tapSource: Pick<TapSource, "isHeadPoint" | "handlePatStart" | "handlePatEnd" | "handlePatAbort">;
  holdMs: () => number;
  onTap?: () => void;
}): PatGesture {
  return {
    isPatPoint: deps.tapSource.isHeadPoint,
    holdMs: deps.holdMs,
    onStart: () => {
      deps.hitTest.suspend();
      deps.tapSource.handlePatStart();
      deps.onTap?.();
    },
    onEnd: () => {
      deps.hitTest.resume();
      deps.tapSource.handlePatEnd();
    },
    onAbort: () => {
      deps.hitTest.resume();
      deps.tapSource.handlePatAbort();
    },
  };
}

export async function wireStageGestures(deps: {
  stage: HTMLElement;
  bus: EventBus;
  renderer: Renderer;
  getConfig: () => AppConfig;
  drainSignals: () => SignalGroup[];
  hitTest: Pick<HitTestController, "suspend" | "resume">;
  locomotion: Pick<
    ReturnType<typeof wireLocomotion>,
    "setDragging" | "cancel" | "dropSource" | "abortTravel"
  >;
  cameraSettings: Pick<ReturnType<typeof createCameraSettings>, "get" | "setAzimuth" | "setPolar">;
  /** A click on the character or a pat start, after its tap handling. */
  onTap?: () => void;
  onDragEnd?: () => void;
  /** True while the orbit gesture is ignored. */
  isCameraLocked?: () => boolean;
  /** True while the tap and drag-hold sources drop their cues. */
  isCueHeld?: () => boolean;
  register: (teardown: () => void) => void;
}): Promise<void> {
  const {
    stage,
    bus,
    renderer,
    getConfig,
    drainSignals,
    hitTest,
    locomotion,
    cameraSettings,
    register,
  } = deps;

  const tapSource = createTapSource({
    bus,
    renderer,
    config: getConfig().avatar.tap,
    drainSignals,
    isHeld: deps.isCueHeld,
  });
  const dragHold = createDragHoldSource({
    bus,
    getHoldMs: () => getConfig().avatar.drag_hold_ms,
    getCue: () => getConfig().avatar.gesture_cues.drag_held,
    isHeld: deps.isCueHeld,
  });
  register(() => dragHold.noteDragEnd());
  const cleanupDrag = await initDrag(stage, {
    onClick: (pos) => {
      tapSource.handleClick(pos);
      deps.onTap?.();
    },
    pat: createPatGesture({
      hitTest,
      tapSource,
      holdMs: () => getConfig().avatar.tap.pat_hold_ms,
      onTap: deps.onTap,
    }),
    onDragStart: () => {
      locomotion.setDragging(true);
      locomotion.dropSource.noteUserDrag();
      locomotion.cancel();
      hitTest.suspend();
      dragHold.noteDragStart();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_start",
        ts: Date.now(),
      });
      // A cancelled climb or stroll may still be unparking its travel; the native
      // drag waits for this before it can grab the window.
      return locomotion.abortTravel();
    },
    onDragEnd: () => {
      locomotion.setDragging(false);
      hitTest.resume();
      dragHold.noteDragEnd();
      locomotion.dropSource.noteUserDragEnd();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_end",
        ts: Date.now(),
      });
      deps.onDragEnd?.();
    },
    onOrbitStart: hitTest.suspend,
    onOrbitEnd: hitTest.resume,
    onOrbit: (d) => {
      if (deps.isCameraLocked?.()) return;
      orbitCamera(cameraSettings, d);
    },
  });
  register(cleanupDrag);
}
