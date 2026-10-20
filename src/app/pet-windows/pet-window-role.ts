/** The pet role owns preset stores and lifecycle synchronization through application teardown. */
import { createSettingsBridge, type SettingsBridge } from "../../io/bridge/settings-bridge";
import {
  closePetWindow,
  createPetWindowOpener,
  type PetWindowOpener,
} from "../../io/window/openers/pet-window";
import type { Logger } from "../../logger";
import { createPetWindows } from "../../settings/preset/pet-windows";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { createDisposers } from "../disposers";
import { closeIfOrphan } from "./close-if-orphan";
import { wireBoundWindow } from "./wire-bound-window";
import { wirePetWindowsReconcile } from "./wire-pet-windows-reconcile";
import { wirePetWindowsSync } from "./wire-pet-windows-sync";

export function createPetWindowRole(deps: {
  boundId: string | null;
  disposeWindow: () => void;
  log: Logger;
  bridge?: SettingsBridge;
  opener?: PetWindowOpener;
  close?: () => void | Promise<void>;
}) {
  const lifecycle = createDisposers();
  const presetRegistry = createPresetRegistry();
  lifecycle.register(presetRegistry.dispose);
  const close = deps.close ?? closePetWindow;
  if (
    closeIfOrphan({
      boundId: deps.boundId,
      registry: presetRegistry,
      close: () => {
        const failed = (error: unknown) =>
          deps.log.error("pet_window_close_failed", { preset: deps.boundId, error: String(error) });
        try {
          void Promise.resolve(close()).catch(failed);
        } catch (error) {
          failed(error);
        }
      },
      log: deps.log,
    })
  ) {
    deps.bridge?.dispose();
    lifecycle.dispose();
    return null;
  }
  const bridge = deps.bridge ?? createSettingsBridge(undefined, { windowKind: "pet" });
  lifecycle.register(bridge.dispose);
  const petWindows = createPetWindows();
  lifecycle.register(petWindows.dispose);
  lifecycle.register(wirePetWindowsSync({ petWindows, bridge }));
  if (deps.boundId !== null) {
    lifecycle.register(
      wireBoundWindow({
        boundId: deps.boundId,
        petWindows,
        bridge,
        disposeStores: deps.disposeWindow,
        disposeSync: lifecycle.dispose,
        close,
        log: deps.log,
      }),
    );
  } else {
    lifecycle.register(
      wirePetWindowsReconcile({
        petWindows,
        registry: presetRegistry,
        opener: deps.opener ?? createPetWindowOpener(),
        log: deps.log,
      }),
    );
  }
  return {
    petWindows,
    presetRegistry,
    dispose() {
      try {
        deps.disposeWindow();
      } finally {
        lifecycle.dispose();
      }
    },
  };
}
