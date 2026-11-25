/** Wires the come-along: her own settings window's stage slots, close and minimise drive it over the locomotion. */
import { createComeAlong } from "../../ambient/come-along/come-along";
import { prefersReducedMotion } from "../../ambient/liveliness/tier1";
import type { StageConfig } from "../../config/validators/avatar/types";
import type { MotionKind } from "../../contract";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import { lastBackendEmotion } from "../../io/chat/last-emotion/last-emotion";
import type { HitTestController } from "../../io/window/pet/hit-test";
import {
  attachDock,
  detachDock,
  onSettingsStageEnded,
  setPetFramePhysical,
} from "../../io/window/pet/window-dock";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import { windowLabel } from "../../settings/preset/pet-windows";
import { isTauri, isWindows } from "../../tauri-env";
import type { wireLocomotion } from "./wire-locomotion";
import { waitRefit } from "./wire-window-geometry";

const log = createLogger("wire-come-along");

export function wireComeAlong(deps: {
  /** This pet window's bound preset; null for main, whose settings window sends preset null. */
  boundId: string | null;
  onSettingsStage: SettingsBridge["onSettingsStage"];
  emitSettingsStageAsk: SettingsBridge["emitSettingsStageAsk"];
  /** Settles once this window's bridge listeners are in place. */
  bridgeListening: () => Promise<void>;
  locomotion: Pick<
    ReturnType<typeof wireLocomotion>,
    | "hold"
    | "abortTravel"
    | "widen"
    | "release"
    | "drop"
    | "frame"
    | "getAvatarExecutor"
    | "onHoldReleased"
    | "onMoverTakesOver"
    | "isTravelling"
    | "ready"
  >;
  peek: { active(): boolean; exit(): Promise<void> };
  renderer: Renderer;
  hitTest: Pick<HitTestController, "setMoving">;
  getStageConfig: () => StageConfig;
  getMotionKind: (id: string) => MotionKind | undefined;
  register: (teardown: () => void) => void;
}): void {
  if (!isTauri()) return;
  const { boundId, locomotion, register } = deps;
  const settingsLabel = boundId === null ? "settings" : windowLabel("settings", boundId);
  const comeAlong = createComeAlong({
    settingsLabel,
    storage: sessionStorage,
    isBusy: () => locomotion.getAvatarExecutor()?.isBusy() ?? false,
    peek: deps.peek,
    locomotion,
    renderer: deps.renderer,
    hitTest: deps.hitTest,
    dock: { attach: attachDock, detach: detachDock },
    setFramePhysical: setPetFramePhysical,
    followsInPhysicalPx: isWindows(),
    pageHeight: () => window.innerHeight,
    pageAt: waitRefit,
    reducedMotion: prefersReducedMotion,
    stage: deps.getStageConfig,
    lastEmotion: (decayMs) => lastBackendEmotion(Date.now(), decayMs),
    random: Math.random,
    getMotionKind: deps.getMotionKind,
  });
  const failed = (err: unknown): void => log.warn("come_along_failed", { error: String(err) });
  void (async () => {
    // Her real window must be wired before a slot moves it.
    await locomotion.ready;
    register(
      deps.onSettingsStage(({ preset, slot }) => {
        if (preset === boundId) void comeAlong.onStage(slot).catch(failed);
      }),
    );
    register(
      await onSettingsStageEnded(settingsLabel, () => void comeAlong.goHome().catch(failed)),
    );
    // The Character menu lets go after its parked frame ends: the newest slot applies then.
    register(locomotion.onHoldReleased(() => void comeAlong.place().catch(failed)));
    register(locomotion.onMoverTakesOver(() => comeAlong.restoreSize()));
    // Both listeners are in place before the answer can arrive.
    await deps.bridgeListening();
    deps.emitSettingsStageAsk();
  })().catch(failed);
}
