/**
 * Sends a settings window's stage slot, where her window docks, to its pet window: at boot, on a
 * move, resize or visibility change when it changed, and on every ask; null while minimised.
 */

import { createLogger } from "../../../logger";
import { isTauri } from "../../../tauri-env";
import type { SettingsStage, StageSlot } from "../../bridge/settings-bridge";
import { latestOnly } from "../latest-only";

const log = createLogger("stage-slot");

export function sendStageSlot(deps: {
  emit(stage: SettingsStage): void;
  onAsk(cb: () => void): () => void;
  /** The window's bound preset; null for main's settings window. */
  preset: string | null;
  /** The stage column; its top padding is the slot's height. */
  stage: HTMLElement;
}): () => void {
  if (!isTauri()) return () => {};
  const { preset, stage } = deps;
  const current = import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
  let disposed = false;
  const unlisteners: Array<() => void> = [];
  let asked = false;
  // A visibility change voids a read already in flight.
  let epoch = 0;
  let last = "";

  async function read(): Promise<StageSlot | null> {
    const win = await current;
    const [inner, innerSize, scale, minimized] = await Promise.all([
      win.innerPosition(),
      win.innerSize(),
      win.scaleFactor(),
      win.isMinimized(),
    ]);
    if (minimized) return null;
    const box = stage.getBoundingClientRect();
    // macOS counts the title bar inside the inner position and size; the page starts below it.
    const titleBar = innerSize.height / scale - window.innerHeight;
    return {
      x: inner.x / scale + box.left,
      y: inner.y / scale + titleBar + box.top,
      width: box.width,
      height: Number.parseFloat(getComputedStyle(stage).paddingTop),
      scale,
    };
  }

  const send = latestOnly(async () => {
    const seen = epoch;
    const slot = await read();
    if (disposed || seen !== epoch) return;
    const sent = JSON.stringify(slot);
    if (sent === last && !asked) return;
    last = sent;
    asked = false;
    deps.emit({ preset, slot });
  });
  const trySend = (): void =>
    void send().catch((err) => log.warn("stage_slot_read_failed", { error: String(err) }));

  const onVisibility = (): void => {
    epoch += 1;
    trySend();
  };
  document.addEventListener("visibilitychange", onVisibility);
  unlisteners.push(
    () => document.removeEventListener("visibilitychange", onVisibility),
    deps.onAsk(() => {
      asked = true;
      trySend();
    }),
  );
  void (async () => {
    const win = await current;
    for (const off of [await win.onMoved(trySend), await win.onResized(trySend)])
      if (disposed) off();
      else unlisteners.push(off);
  })().catch((err) => log.warn("stage_slot_listen_failed", { error: String(err) }));
  trySend();

  return () => {
    disposed = true;
    for (const off of unlisteners.splice(0)) off();
  };
}
