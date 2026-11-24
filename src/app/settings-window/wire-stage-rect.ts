/**
 * Sends this settings window's stage slot, where her window docks, to its pet window: at boot, on a
 * move, resize or visibility change when it changed, and on every ask; null while minimised.
 */

import type { SettingsBridge, StageRect } from "../../io/bridge/settings-bridge";
import { createLogger } from "../../logger";
import { isTauri } from "../../tauri-env";

const log = createLogger("wire-stage-rect");

export function wireStageRect(deps: {
  bridge: Pick<SettingsBridge, "emitSettingsStage" | "onSettingsStageAsk">;
  boundId: string | null;
  /** The stage column; its top padding is the slot's height. */
  stage: HTMLElement;
}): () => void {
  if (!isTauri()) return () => {};
  const { bridge, boundId, stage } = deps;
  const current = import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
  let disposed = false;
  const unlisteners: Array<() => void> = [];
  // One read in flight; a trigger during it reads again, and a visibility change voids it.
  let sending = false;
  let again = false;
  let asked = false;
  let epoch = 0;
  let last = "";

  async function read(): Promise<StageRect | null> {
    const win = await current;
    const [inner, scale, minimized] = await Promise.all([
      win.innerPosition(),
      win.scaleFactor(),
      win.isMinimized(),
    ]);
    if (minimized) return null;
    const box = stage.getBoundingClientRect();
    return {
      x: inner.x / scale + box.left,
      y: inner.y / scale + box.top,
      width: box.width,
      height: Number.parseFloat(getComputedStyle(stage).paddingTop),
      scale,
    };
  }

  async function send(): Promise<void> {
    if (sending) {
      again = true;
      return;
    }
    sending = true;
    try {
      do {
        again = false;
        const seen = epoch;
        const rect = await read();
        if (disposed) return;
        if (seen !== epoch) {
          again = true;
          continue;
        }
        const stageRect = { preset: boundId, rect };
        const sent = JSON.stringify(stageRect);
        if (sent === last && !asked) continue;
        last = sent;
        asked = false;
        bridge.emitSettingsStage(stageRect);
      } while (again);
    } catch (err) {
      log.warn("stage_rect_read_failed", { error: String(err) });
    } finally {
      sending = false;
    }
  }

  const onVisibility = (): void => {
    epoch += 1;
    void send();
  };
  document.addEventListener("visibilitychange", onVisibility);
  unlisteners.push(
    () => document.removeEventListener("visibilitychange", onVisibility),
    bridge.onSettingsStageAsk(() => {
      asked = true;
      void send();
    }),
  );
  void (async () => {
    const win = await current;
    for (const off of [
      await win.onMoved(() => void send()),
      await win.onResized(() => void send()),
    ])
      if (disposed) off();
      else unlisteners.push(off);
  })().catch((err) => log.warn("stage_rect_listen_failed", { error: String(err) }));
  void send();

  return () => {
    disposed = true;
    for (const off of unlisteners.splice(0)) off();
  };
}
