import type { EmotionId, MotionRegistry } from "../../../contract";
import { variantName } from "./variants";

/** The committed clip: its registry id and the file playing for it. */
export interface Clip {
  id: string;
  vrma_path: string;
}

/** The elements the live status writes every frame; React renders none of their text. */
export interface StatusRefs {
  now: HTMLElement;
  kind: HTMLElement;
  priority: HTMLElement;
  elapsed: HTMLElement;
  fps: HTMLElement;
  viewport: HTMLElement;
}

export function createLiveStatus(
  refs: StatusRefs,
  emotion: () => EmotionId | null,
  onClip: (clip: Clip | null) => void,
): {
  start(getCurrentMotion: () => Clip | null, registry: MotionRegistry): void;
  stop(): void;
} {
  refs.now.textContent = "loading";
  refs.kind.textContent = "-";
  refs.priority.textContent = "-";
  refs.elapsed.textContent = "0.0s";
  refs.fps.textContent = "0fps";
  refs.viewport.textContent = "idle · 0fps";

  let activeId: string | null = null;
  /** Elapsed seconds count from here; resets per clip, a variant swap included. */
  let elapsedStart = 0;
  let fps = 0;
  /** Reads renderer.getCurrentMotion(); null until the renderer is created. */
  let liveMotion: (() => Clip | null) | null = null;
  let liveRegistry: MotionRegistry | null = null;
  /** `${id}|${vrma_path}` of the last synced clip — gates the per-clip writes and reports. */
  let lastLiveKey = "";
  let fpsFrames = 0;
  let fpsLast = performance.now();
  let rafId = 0;

  function syncLiveMotion(): Clip | null {
    const cur = liveMotion?.() ?? null;
    const key = cur ? `${cur.id}|${cur.vrma_path}` : "";
    if (key === lastLiveKey) return cur;
    lastLiveKey = key;

    activeId = cur?.id ?? null;
    elapsedStart = performance.now();
    onClip(cur);

    const entry = cur && liveRegistry ? liveRegistry[cur.id] : undefined;
    refs.now.textContent = cur ? cur.id : "none";
    refs.kind.textContent = entry ? entry.kind : "-";
    refs.priority.textContent = entry ? `p${entry.priority}` : "-";
    return cur;
  }

  function rafLoop(): void {
    rafId = requestAnimationFrame(rafLoop);
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLast >= 500) {
      fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
      fpsFrames = 0;
      fpsLast = now;
    }

    const cur = syncLiveMotion();
    const elapsedSec =
      activeId !== null ? ((performance.now() - elapsedStart) / 1000).toFixed(1) : "0.0";
    refs.elapsed.textContent = `${elapsedSec}s`;
    refs.fps.textContent = `${fps}fps`;
    const variant = cur ? variantName(cur.vrma_path) : null;
    const variantHint = cur && variant !== cur.id ? ` (${variant})` : "";
    const active = emotion();
    const emotionHint = active !== null ? ` · em:${active}` : "";
    refs.viewport.textContent = `${cur?.id ?? "none"}${variantHint}${emotionHint} · ${fps}fps`;
  }

  return {
    start(getCurrentMotion, registry) {
      liveMotion = getCurrentMotion;
      liveRegistry = registry;
      rafId = requestAnimationFrame(rafLoop);
    },
    stop() {
      cancelAnimationFrame(rafId);
    },
  };
}
