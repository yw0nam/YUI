import type { Renderer, RenderMotionSignal } from "../../../renderer";
import type { MotionPreviewView } from "./view";

export function wireMotionControls(
  view: MotionPreviewView,
  renderer: Renderer,
): (id: string) => void {
  const { cbLoop, slSpeed, slFade, selCrossfade, btnPlay, btnStop, btnIdle } = view;

  // ─── Playback helpers ──────────────────────────────────────────────────

  function currentSignalOverrides(): Partial<RenderMotionSignal> {
    return {
      loop: cbLoop.checked,
      speed: parseFloat(slSpeed.value),
      fade_ms: parseInt(slFade.value, 10),
    };
  }

  function doPlayById(id: string): void {
    const overrides = currentSignalOverrides();
    const signal: RenderMotionSignal = { id, ...overrides };
    renderer.playMotion(signal);
    // Row highlight / status bar follow via the per-frame syncLiveMotion polling in live-status.ts.
  }

  function doIdleReturn(): void {
    // "-> idle" is the reset: playMotion({ id: "idle" })
    // There is no explicit stop in the renderer API; idle is the baseline.
    doPlayById("idle");
  }

  function doStop(): void {
    // The renderer has no explicit stop method. Replaying idle is the correct reset path.
    // "stop" here means return to idle as the nearest available no-op.
    doIdleReturn();
  }

  // Wire motion action buttons (close over doPlayById/doStop/doIdleReturn).
  btnPlay.addEventListener("click", () => {
    const id = selCrossfade.value;
    if (id) doPlayById(id);
  });

  btnStop.addEventListener("click", () => {
    doStop();
  });

  btnIdle.addEventListener("click", () => {
    doIdleReturn();
  });

  return doPlayById;
}
