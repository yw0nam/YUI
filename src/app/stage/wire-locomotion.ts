/** Composes the travel frame, the five locomotion loops and the window sources into one handle. */
import { createSitter, type Sitter } from "../../ambient/locomotion/sitter";
import {
  wireClimber,
  wireFaller,
  wirePercher,
  wireStrollReflexCancel,
  wireTravelFrame,
  wireWalker,
} from "../../ambient/locomotion/wire";
import type { AppConfig, DescendConfig, FallConfig } from "../../config/load";
import type { WindowRect } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { createVrmSelection } from "../../io/assets/vrm-selection";
import type { createAgentNotifySettings } from "../../io/settings/agent-notify-settings";
import type { FlagSettingsStore } from "../../io/settings/persisted-store";
import type { DescentEdge } from "../../io/window/geometry/screen-geometry";
import type { HitTestController } from "../../io/window/pet/hit-test";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import { wireWindowSources } from "../turn/wire-sources";

/** With the fall off, a perched stroll never steps off the ledge: nothing would catch her. */
export function fallConfigFor(fall: FallConfig, enabled: boolean): FallConfig {
  return enabled ? fall : { ...fall, step_off_probability: 0 };
}

/** With the fall off, a monitor descent always climbs down: nothing would catch a drop. */
export function descendConfigFor(descend: DescendConfig, enabled: boolean): DescendConfig {
  return enabled ? descend : { ...descend, climb_down_chance: 1 };
}

/**
 * The fall a lost sit starts. A descent still inside its window survey resumes on a stale
 * list and moves the window from under the faller, so the climb lets go before the drop.
 */
export function createSitLossFall(deps: {
  getClimber: () => { cancel(): void } | null;
  faller: { drop(): Promise<void> };
}): () => void {
  return () => {
    deps.getClimber()?.cancel();
    void deps.faller.drop();
  };
}

export function wireLocomotion(deps: {
  bus: EventBus;
  renderer: Renderer;
  getConfig: () => AppConfig;
  dispatcher: Dispatcher;
  hitTest: Pick<HitTestController, "setMoving">;
  peekActive: () => boolean;
  fallSettings: FlagSettingsStore;
  climbSettings: FlagSettingsStore;
  agentNotifySettings: ReturnType<typeof createAgentNotifySettings>;
  vrmSelection: Pick<ReturnType<typeof createVrmSelection>, "getActive">;
  onStrollEnd: (bodyReleased: boolean) => void;
  register: (teardown: () => void) => void;
  log: Logger;
}): {
  walker: { isStrolling(): boolean };
  sitter: Sitter;
  dropSource: { noteUserDrag(): void; noteUserDragEnd(): void };
  setDragging(dragging: boolean): void;
  /** Cancels the five loops in the order a drag start and an agent move cancel them. */
  cancel(): void;
  abortTravel(): Promise<void>;
} {
  const {
    bus,
    renderer,
    getConfig,
    dispatcher,
    hitTest,
    peekActive,
    fallSettings,
    climbSettings,
    agentNotifySettings,
    vrmSelection,
    onStrollEnd,
    register,
    log,
  } = deps;

  // Set once the drop source exists — the travel frame pauses its keep-on-screen guard
  // while it parks the window itself.
  let windowSourcesRef: { setKeepOnScreenPaused(paused: boolean): void } | null = null;
  const travelFrame = wireTravelFrame({
    renderer,
    setKeepOnScreenPaused: (paused) => windowSourcesRef?.setKeepOnScreenPaused(paused),
    log,
  });
  register(travelFrame.dispose);

  // Ambient walking outranks nothing: a drag, an agent command or a reflex turn cancels a
  // stroll at once; an ordinary turn walks on.
  let dragging = false;
  let climberRef: { cancel(): void; descend(edge: DescentEdge): Promise<void> } | null = null;
  const walker = wireWalker({
    bus,
    renderer,
    travelFrame,
    getWalkConfig: () => getConfig().avatar.walk,
    getDescendConfig: () => getConfig().avatar.descend,
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    isPeeking: () => peekActive(),
    isDragging: () => dragging,
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    onStrollEnd,
    onDescend: (edge) => climberRef?.descend(edge),
    log,
  });
  register(walker.dispose);
  register(wireStrollReflexCancel({ dispatcher, walker }));

  // Set once each loop exists — the drop source and the faller are built before them.
  let percherRef: { cancel(): void; landOn(target: WindowRect): void } | null = null;

  // The seat transitions every seat entry and voluntary exit plays; one body, one sitter.
  const sitter = createSitter({
    renderer,
    currentMotionKind: () => {
      const current = renderer.getCurrentMotion();
      return current ? (getConfig().motions[current.id]?.kind ?? null) : null;
    },
  });
  sitter.start();
  register(sitter.stop);

  // A character left mid-air drops to the first surface below her; the user outranks it.
  const faller = wireFaller({
    bus,
    renderer,
    travelFrame,
    isEnabled: () => fallSettings.get().enabled,
    getFallConfig: () => getConfig().avatar.fall,
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    getFloorTolerancePx: () => getConfig().avatar.walk.floor_tolerance_px,
    getGestureCues: () => getConfig().avatar.gesture_cues,
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    onWindowLand: (target) => percherRef?.landOn(target),
    log,
  });
  register(faller.dispose);

  const windowSources = wireWindowSources({
    bus,
    renderer,
    peekActive: () => peekActive(),
    getPeekConfig: () => getConfig().avatar.peek,
    getGestureCues: () => getConfig().avatar.gesture_cues,
    agentNotifySettings,
    getPosture: () => dispatcher.getPosture(),
    getVrm: () => {
      const active = vrmSelection.getActive();
      return { id: active.id, label: active.label ?? active.id };
    },
    noteAvatarMoved: () => dispatcher.noteAvatarMoved(),
    noteAgentMove: () => {
      walker.cancel();
      faller.cancel();
      climberRef?.cancel();
      percherRef?.cancel();
      sitter.cancel();
      // A cancelled climb or stroll may still be unparking its travel.
      return travelFrame.abort();
    },
    onDragMiss: () => faller.drop({ landOnSeam: true }),
    onSitLost: createSitLossFall({ getClimber: () => climberRef, faller }),
    sitDown: () => sitter.sitDown(null),
    log,
  });
  windowSourcesRef = windowSources;
  register(windowSources.dispose);

  const percher = wirePercher({
    bus,
    renderer,
    getPerchWalkConfig: () => getConfig().avatar.perch_walk,
    getJumpConfig: () => getConfig().avatar.jump,
    getFallConfig: () => fallConfigFor(getConfig().avatar.fall, fallSettings.get().enabled),
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    isBusy: dispatcher.isPipelineBusy,
    walker,
    sitter,
    dropSource: windowSources,
    onHostLost: () => faller.drop(),
    // A jump that loses its target leaves her mid-air, the same as a lost host does.
    onTargetLost: () => faller.drop(),
    // She walked past the edge on purpose; the drop is what she walked off for.
    onStepOff: () => faller.drop(),
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    log,
  });
  percherRef = percher;
  register(percher.dispose);

  // Ambient climbing: a wall now and then, a sit on top, then back down to the floor.
  const climber = wireClimber({
    bus,
    renderer,
    travelFrame,
    getClimbConfig: () => getConfig().avatar.climb,
    getDescendConfig: () =>
      descendConfigFor(getConfig().avatar.descend, fallSettings.get().enabled),
    getFallConfig: () => getConfig().avatar.fall,
    getWalkConfig: () => getConfig().avatar.walk,
    getMotionKind: (id) => getConfig().motions[id]?.kind,
    isPeeking: () => peekActive(),
    isDragging: () => dragging,
    isBusy: dispatcher.isPipelineBusy,
    walker,
    faller,
    sitter,
    dropSource: windowSources,
    setHitTestMoving: (moving) => hitTest.setMoving(moving),
    log,
  });
  climberRef = climber;
  climber.setEnabled(climbSettings.get().enabled);
  register(climbSettings.subscribe((state) => climber.setEnabled(state.enabled)));
  register(climber.dispose);

  return {
    walker,
    sitter,
    dropSource: windowSources,
    setDragging(next) {
      dragging = next;
    },
    cancel: () => {
      walker.cancel();
      faller.cancel();
      climber.cancel();
      percher.cancel();
      sitter.cancel();
    },
    abortTravel: () => travelFrame.abort(),
  };
}
