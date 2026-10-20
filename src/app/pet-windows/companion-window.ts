/** A companion holds its own deletion guard until its writable stores finish teardown. */

import {
  destroyCurrentWindow,
  listenCurrentWindowCloseRequested,
} from "../../io/window/current-window";
import { watchOwner } from "../../io/window/openers/companion-windows";
import type { Logger } from "../../logger";
import { readBoundPresetId } from "../../settings/preset/bound-preset";
import { clearWindowLive, setWindowLive, windowLabel } from "../../settings/preset/pet-windows";
import { createPresetRegistry, type PresetRegistry } from "../../settings/preset/preset-registry";
import { isTauri } from "../../tauri-env";
import type { Disposers } from "../disposers";
import { closeIfOrphan } from "./close-if-orphan";

export async function wireCompanionWindow(deps: {
  label: string;
  boundId: string;
  registry: Pick<PresetRegistry, "get">;
  disposeWindow(): void;
  close(): void | Promise<void>;
  log: Logger;
}): Promise<{ alive: boolean; dispose(): void; close(): Promise<void> }> {
  let disposed = false;
  let live = false;
  let offOwner = () => {};
  let offClose = () => {};
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("beforeunload", dispose);
    try {
      deps.disposeWindow();
    } finally {
      if (live) clearWindowLive(deps.label);
      offOwner();
      offClose();
    }
  };
  const close = async () => {
    if (disposed) return;
    try {
      dispose();
    } finally {
      await deps.close();
    }
  };
  const role = {
    get alive() {
      return live && !disposed;
    },
    dispose,
    close,
  };
  if (
    closeIfOrphan({
      ...deps,
      close: () => {
        void close().catch((error) =>
          deps.log.warn("companion_close_failed", { preset: deps.boundId, error: String(error) }),
        );
      },
    })
  )
    return role;
  const watcher = await watchOwner(deps.boundId, () => {
    deps.log.info("companion_orphan", { preset: deps.boundId, kind: deps.label.split("-")[0] });
    return close();
  });
  offOwner = watcher.dispose;
  if (!watcher.alive || disposed) {
    offOwner();
    return role;
  }
  offClose = await listenCurrentWindowCloseRequested(() => {
    try {
      dispose();
    } catch (error) {
      deps.log.warn("companion_dispose_failed", { preset: deps.boundId, error: String(error) });
    }
  });
  if (disposed) {
    offClose();
    return role;
  }
  setWindowLive(deps.label);
  live = true;
  if (!isTauri()) window.addEventListener("beforeunload", dispose);
  return role;
}

export async function bootCompanion(
  kind: "settings" | "message",
  lifecycle: Disposers,
  log: Logger,
) {
  const boundId = readBoundPresetId();
  const registry = createPresetRegistry();
  lifecycle.register(registry.dispose);
  const companion =
    boundId === null
      ? null
      : await wireCompanionWindow({
          label: windowLabel(kind, boundId),
          boundId,
          registry,
          disposeWindow: lifecycle.dispose,
          close: destroyCurrentWindow,
          log,
        });
  return { boundId, registry, alive: companion?.alive ?? !lifecycle.isDisposed() };
}
