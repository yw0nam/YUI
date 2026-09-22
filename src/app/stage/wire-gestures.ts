/** Wires the stage's pointer gestures: taps, pats, the drag and the camera orbit. */
import type { Tier1Engine } from "../../ambient/liveliness/tier1";
import type { AppConfig } from "../../config/load";
import type { SignalGroup } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import { createDragHoldSource } from "../../dispatcher/sources/drag-hold-source";
import { createTapSource, type TapSource } from "../../dispatcher/sources/tap-source";
import { initDrag, type PatGesture } from "../../io/window/pet/drag";
import type { HitTestController } from "../../io/window/pet/hit-test";
import type { Renderer } from "../../renderer";
import {
  CAMERA_ORBIT_SENSITIVITY,
  type createCameraSettings,
} from "../../settings/avatar/camera-settings";
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
}): PatGesture {
  return {
    isPatPoint: deps.tapSource.isHeadPoint,
    holdMs: deps.holdMs,
    onStart: () => {
      deps.hitTest.suspend();
      deps.tapSource.handlePatStart();
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
  ambient: Pick<Tier1Engine, "trigger">;
  getConfig: () => AppConfig;
  drainSignals: () => SignalGroup[];
  hitTest: Pick<HitTestController, "suspend" | "resume">;
  locomotion: Pick<
    ReturnType<typeof wireLocomotion>,
    "setDragging" | "cancel" | "dropSource" | "abortTravel"
  >;
  cameraSettings: Pick<ReturnType<typeof createCameraSettings>, "get" | "setAzimuth" | "setPolar">;
  register: (teardown: () => void) => void;
}): Promise<void> {
  const {
    stage,
    bus,
    renderer,
    ambient,
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
    ambient,
    config: getConfig().avatar.tap,
    drainSignals,
  });
  const dragHold = createDragHoldSource({
    bus,
    getHoldMs: () => getConfig().avatar.drag_hold_ms,
    getCue: () => getConfig().avatar.gesture_cues.drag_held,
  });
  register(() => dragHold.noteDragEnd());
  const cleanupDrag = await initDrag(stage, {
    onClick: tapSource.handleClick,
    pat: createPatGesture({
      hitTest,
      tapSource,
      holdMs: () => getConfig().avatar.tap.pat_hold_ms,
    }),
    onDragStart: () => {
      locomotion.setDragging(true);
      locomotion.cancel();
      hitTest.suspend();
      dragHold.noteDragStart();
      locomotion.dropSource.noteUserDrag();
      bus.push({
        source: "os_event_watcher",
        event_name: "user.drag_start",
        ts: Date.now(),
        hint_tier: 1,
        dnd_override: true,
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
        hint_tier: 1,
        dnd_override: true,
      });
    },
    onOrbitStart: hitTest.suspend,
    onOrbitEnd: hitTest.resume,
    onOrbit: ({ dx, dy }) => {
      const current = cameraSettings.get();
      cameraSettings.setAzimuth(current.azimuth + dx * CAMERA_ORBIT_SENSITIVITY);
      cameraSettings.setPolar(current.polar - dy * CAMERA_ORBIT_SENSITIVITY);
    },
  });
  register(cleanupDrag);
}
