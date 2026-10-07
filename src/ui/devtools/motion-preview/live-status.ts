import type { MotionRegistry } from "../../../contract";
import type { ActiveEmotion } from "./emotion-panel";
import { setActiveRow } from "./registry-list";
import { variantName } from "./variants";
import type { MotionPreviewView } from "./view";

// ─── State ───────────────────────────────────────────────────────────────────

interface PlaybackState {
  /** ID of the committed motion (synced from renderer.getCurrentMotion each frame). */
  activeId: string | null;
  /** Elapsed seconds since last play action. */
  elapsedStart: number;
  /** Live fps from rAF counter. */
  fps: number;
}

export function createLiveStatus(
  view: MotionPreviewView,
  activeEmotion: ActiveEmotion,
): {
  start(
    getCurrentMotion: () => { id: string; vrma_path: string } | null,
    registry: MotionRegistry,
  ): void;
  stop(): void;
} {
  const {
    mount,
    registryList,
    statusNow,
    statusKind,
    statusPriority,
    statusElapsed,
    statusFps,
    viewportStatus,
  } = view;

  // ─── Per-instance state ────────────────────────────────────────────────────

  const state: PlaybackState = {
    activeId: null,
    elapsedStart: 0,
    fps: 0,
  };

  /** Reads renderer.getCurrentMotion(); null until the renderer is created. */
  let liveMotion: (() => { id: string; vrma_path: string } | null) | null = null;
  let liveRegistry: MotionRegistry | null = null;
  /** `${id}|${vrma_path}` of the last synced motion — gates per-frame DOM writes. */
  let lastLiveKey = "";
  let fpsFrames = 0;
  let fpsLast = view.initialFpsLast;
  let rafId = 0;

  /** Sync row highlight / status bar / idle sub-line to the committed motion. */
  function syncLiveMotion(): { id: string; vrma_path: string } | null {
    const cur = liveMotion?.() ?? null;
    const key = cur ? `${cur.id}|${cur.vrma_path}` : "";
    if (key === lastLiveKey) return cur;
    lastLiveKey = key;

    state.activeId = cur?.id ?? null;
    state.elapsedStart = performance.now(); // per-clip: resets on variant swap too

    setActiveRow(registryList, cur?.id ?? null);

    const entry = cur && liveRegistry ? liveRegistry[cur.id] : undefined;
    statusNow.textContent = cur ? cur.id : "none";
    statusKind.textContent = entry ? entry.kind : "-";
    statusPriority.textContent = entry ? `p${entry.priority}` : "-";

    const subLine = mount.querySelector("#idle-sub-line");
    const variants = liveRegistry?.idle?.variants;
    if (subLine && cur && cur.id === "idle" && variants) {
      const idx = variants.indexOf(cur.vrma_path);
      if (idx >= 0) {
        const count = document.createElement("span");
        count.textContent = `${idx + 1}/${variants.length}`;
        subLine.replaceChildren(
          document.createTextNode("variant "),
          count,
          document.createTextNode(" · "),
          document.createTextNode(variantName(cur.vrma_path)),
        );
      }
    }
    return cur;
  }

  // ─── FPS counter + elapsed timer ─────────────────────────────────────────

  function rafLoop(): void {
    rafId = requestAnimationFrame(rafLoop);
    fpsFrames++;
    const now = performance.now();
    if (now - fpsLast >= 500) {
      state.fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
      fpsFrames = 0;
      fpsLast = now;
    }

    const cur = syncLiveMotion();

    const elapsedSec =
      state.activeId !== null
        ? ((performance.now() - state.elapsedStart) / 1000).toFixed(1)
        : "0.0";

    statusElapsed.textContent = `${elapsedSec}s`;
    statusFps.textContent = `${state.fps}fps`;
    const variant = cur ? variantName(cur.vrma_path) : null;
    const variantHint = cur && variant !== cur.id ? ` (${variant})` : "";
    const emotionHint = activeEmotion.id !== null ? ` · em:${activeEmotion.id}` : "";
    viewportStatus.textContent = `${cur?.id ?? "none"}${variantHint}${emotionHint} · ${state.fps}fps`;
  }

  function start(
    getCurrentMotion: () => { id: string; vrma_path: string } | null,
    registry: MotionRegistry,
  ): void {
    liveMotion = getCurrentMotion;
    liveRegistry = registry;
    rafId = requestAnimationFrame(rafLoop);
  }

  function stop(): void {
    cancelAnimationFrame(rafId);
  }

  return { start, stop };
}
