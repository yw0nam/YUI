/** A companion holds its own deletion guard until its writable stores finish teardown. */
import type { Logger } from "../../logger";
import { clearWindowLive, setWindowLive } from "../../settings/preset/pet-windows";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { closeIfOrphan } from "./close-if-orphan";
import { watchOwner } from "./companion-windows";

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
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("beforeunload", dispose);
    try {
      deps.disposeWindow();
    } finally {
      if (live) clearWindowLive(deps.label);
      offOwner();
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
  setWindowLive(deps.label);
  live = true;
  window.addEventListener("beforeunload", dispose);
  return role;
}
