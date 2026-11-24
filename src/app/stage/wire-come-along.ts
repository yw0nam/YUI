/** Wires the come-along: her own settings window's stage slots, close and minimise drive it over the locomotion. */
import { createComeAlong } from "../../ambient/come-along/come-along";
import { prefersReducedMotion } from "../../ambient/liveliness/tier1";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { HitTestController } from "../../io/window/pet/hit-test";
import {
  attachDock,
  detachDock,
  onSettingsStageEnded,
  setPetPositionPhysical,
} from "../../io/window/pet/window-dock";
import { createLogger } from "../../logger";
import type { Renderer } from "../../renderer";
import { windowLabel } from "../../settings/preset/pet-windows";
import { isTauri } from "../../tauri-env";
import type { wireLocomotion } from "./wire-locomotion";

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
    | "onResizeApplied"
    | "onHoldReleased"
    | "isTravelling"
    | "ready"
  >;
  peek: { active(): boolean; exit(): Promise<void> };
  renderer: Renderer;
  hitTest: Pick<HitTestController, "setMoving">;
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
    setPositionPhysical: setPetPositionPhysical,
    reducedMotion: prefersReducedMotion,
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
    register(locomotion.onResizeApplied(() => void comeAlong.place().catch(failed)));
    // The Character menu lets go after its parked frame ends: the newest slot applies then.
    register(locomotion.onHoldReleased(() => void comeAlong.place().catch(failed)));
    // Both listeners are in place before the answer can arrive.
    await deps.bridgeListening();
    deps.emitSettingsStageAsk();
  })().catch(failed);
}
