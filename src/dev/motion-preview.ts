/**
 * Motion Preview dev tool entry point.
 *
 * A SEPARATE Vite entry (motion-preview.html), never loaded inside the Tauri pet window.
 * Purpose: screenshot-verification surface for VRM motions.
 *
 * Architecture:
 *   - Imports motions.json directly (Vite JSON import, NOT src/config/load.ts which is Node/fs).
 *   - Uses createRenderer({ mount, motionRegistry }) from src/renderer.
 *   - Loads /vrms/carlotta.vrm (served via public/vrms symlink -> resources/vrms).
 *   - Registry list rendered from the imported JSON, grouped by MotionKind.
 *   - Playback controls compose MotionSignal overrides passed to renderer.playMotion().
 *
 * Status bar tracks last-requested motion UI-side (renderer does not surface current motion
 * back to UI). Oneshot auto-return-to-idle is NOT reflected in status — acceptable for v0;
 * a future renderer event can drive it.
 */

import "./motion-preview.css";
import { createRenderer } from "../renderer";
import type { MotionRegistry, MotionKind, MotionSignal, EmotionRegistry, EmotionId } from "../contract";
import { createLogger } from "../logger";

const log = createLogger("motion-preview");

// ─── Runtime config URLs (served by the custom dev middleware at /configs/*) ──
// Do NOT statically import — Vite rewrites JSON imports to ?import, the middleware
// returns raw JSON (not a JS module), and the browser rejects the whole ES module graph.
const CONFIG_URL = "/configs/motions.json";
const EMOTION_CONFIG_URL = "/configs/emotion_registry.json";

// ─── VRM URL (configurable; default uses the gitignored symlink) ──────────────
const VRM_URL = "/vrms/carlotta.vrm";

// ─── Motion kind display order ────────────────────────────────────────────────
const KIND_ORDER: MotionKind[] = ["ambient", "reactive", "state", "oneshot"];

// ─── Emotion display order (matches contract.md §1 vocabulary) ───────────────
const EMOTION_ORDER: EmotionId[] = [
  "neutral", "happy", "angry", "sad", "relaxed", "surprised",
  "thinking", "curious", "sleepy", "embarrassed",
];

// ─── State ───────────────────────────────────────────────────────────────────

interface PlaybackState {
  /** ID of the motion the user last requested (not necessarily what the renderer is playing). */
  activeId: string | null;
  /** Elapsed seconds since last play action. */
  elapsedStart: number;
  /** Live fps from rAF counter. */
  fps: number;
}

const state: PlaybackState = {
  activeId: null,
  elapsedStart: 0,
  fps: 0,
};

/** ID of the emotion the user last applied (or null if none applied yet). */
let activeEmotionId: EmotionId | null = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
// The module script is deferred so the DOM is ready at this point.

const mount = document.getElementById("vrm-mount") as HTMLDivElement;
const registryList = document.getElementById("registry-list") as HTMLDivElement;
const cbLoop = document.getElementById("cb-loop") as HTMLInputElement;
const slSpeed = document.getElementById("sl-speed") as HTMLInputElement;
const valSpeed = document.getElementById("val-speed") as HTMLSpanElement;
const slFade = document.getElementById("sl-fade") as HTMLInputElement;
const valFade = document.getElementById("val-fade") as HTMLSpanElement;
const selCrossfade = document.getElementById("sel-crossfade") as HTMLSelectElement;
const btnPlay = document.getElementById("btn-play") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const btnIdle = document.getElementById("btn-idle") as HTMLButtonElement;
const statusNow = document.getElementById("status-now") as HTMLSpanElement;
const statusKind = document.getElementById("status-kind") as HTMLSpanElement;
const statusPriority = document.getElementById("status-priority") as HTMLSpanElement;
const statusElapsed = document.getElementById("status-elapsed") as HTMLSpanElement;
const statusFps = document.getElementById("status-fps") as HTMLSpanElement;
const viewportStatus = document.getElementById("viewport-status") as HTMLSpanElement;

// ─── Emotion DOM refs ─────────────────────────────────────────────────────────
const emotionList = document.getElementById("emotion-list") as HTMLDivElement;
const slIntensity = document.getElementById("sl-intensity") as HTMLInputElement;
const valIntensity = document.getElementById("val-intensity") as HTMLSpanElement;
const slTransition = document.getElementById("sl-transition") as HTMLInputElement;
const valTransition = document.getElementById("val-transition") as HTMLSpanElement;
const btnNeutral = document.getElementById("btn-neutral") as HTMLButtonElement;
const btnHold = document.getElementById("btn-hold") as HTMLButtonElement;

// ─── Registry list rendering ──────────────────────────────────────────────────

/** Build the crossfade dropdown options from registry keys. */
function buildCrossfadeOptions(motionsRegistry: MotionRegistry): void {
  selCrossfade.innerHTML = "";
  for (const id of Object.keys(motionsRegistry)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = id;
    if (id === "idle") opt.selected = true;
    selCrossfade.appendChild(opt);
  }
}

/** Set the active row in the registry list. */
function setActiveRow(id: string | null): void {
  const rows = registryList.querySelectorAll<HTMLDivElement>(".motion-row");
  rows.forEach((row) => {
    const rowId = row.dataset["motionId"];
    const dot = row.querySelector<HTMLSpanElement>(".dot");
    const nameEl = row.querySelector<HTMLSpanElement>(".row-name");
    if (rowId === id) {
      row.classList.add("state-playing");
      if (dot) {
        dot.className = "dot dot-filled";
      }
      if (nameEl) nameEl.style.color = "";
    } else {
      row.classList.remove("state-playing");
      if (dot) {
        dot.className = "dot dot-hollow";
      }
      if (nameEl) nameEl.style.color = "";
    }
  });
}

/** Build the full registry list HTML grouped by kind. */
function buildRegistryList(
  motionsRegistry: MotionRegistry,
  doPlayById: (id: string) => void,
): void {
  registryList.innerHTML = "";

  // Group entries by kind in display order
  const groups = new Map<MotionKind, string[]>();
  for (const kind of KIND_ORDER) {
    groups.set(kind, []);
  }
  for (const [id, entry] of Object.entries(motionsRegistry)) {
    const list = groups.get(entry.kind);
    if (list) list.push(id);
  }

  for (const kind of KIND_ORDER) {
    const ids = groups.get(kind);
    if (!ids || ids.length === 0) continue;

    const groupEl = document.createElement("div");
    groupEl.className = "group";

    const labelEl = document.createElement("div");
    labelEl.className = "group-label";
    labelEl.textContent = kind;
    groupEl.appendChild(labelEl);

    for (const id of ids) {
      const entry = motionsRegistry[id];
      if (!entry) continue;

      const row = document.createElement("div");
      row.className = "motion-row";
      row.dataset["motionId"] = id;
      row.tabIndex = 0;
      row.setAttribute("role", "row");

      // Dot
      const dot = document.createElement("span");
      dot.className = "dot dot-hollow";

      // Name
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = id;

      // Tags
      const tags = document.createElement("div");
      tags.className = "row-tags";

      const tagPriority = document.createElement("span");
      tagPriority.className = "tag";
      tagPriority.textContent = `p${entry.priority}`;
      tags.appendChild(tagPriority);

      if (entry.loop) {
        const tagLoop = document.createElement("span");
        tagLoop.className = "tag tag-loop";
        tagLoop.textContent = "loop";
        tags.appendChild(tagLoop);
      }

      // Play button
      const playBtn = document.createElement("button");
      playBtn.className = "btn-play";
      playBtn.title = "play";
      playBtn.setAttribute("aria-label", `Play ${id}`);
      playBtn.textContent = "▶";

      row.appendChild(dot);
      row.appendChild(name);
      row.appendChild(tags);
      row.appendChild(playBtn);
      groupEl.appendChild(row);

      // Idle variant sub-line
      if (id === "idle" && entry.variants && entry.variants.length > 0) {
        const subLine = document.createElement("div");
        subLine.className = "sub-line";
        const varCount = entry.variants.length;
        subLine.innerHTML = `variant <span>1/${varCount}</span> &middot; idle_01`;
        subLine.id = "idle-sub-line";
        groupEl.appendChild(subLine);
      }

      // Row click handler
      const handlePlay = (): void => {
        doPlayById(id);
      };
      row.addEventListener("click", handlePlay);
      row.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handlePlay();
        }
      });
      playBtn.addEventListener("click", (e: MouseEvent) => {
        e.stopPropagation();
        handlePlay();
      });
    }

    registryList.appendChild(groupEl);
  }
}

/** Set the active row in the emotion list (independent of motion active state). */
function setActiveEmotionRow(id: EmotionId | null): void {
  const rows = emotionList.querySelectorAll<HTMLDivElement>(".motion-row");
  rows.forEach((row) => {
    const rowId = row.dataset["emotionId"] as EmotionId | undefined;
    const dot = row.querySelector<HTMLSpanElement>(".dot");
    if (rowId === id) {
      row.classList.add("state-playing");
      if (dot) dot.className = "dot dot-filled";
    } else {
      row.classList.remove("state-playing");
      if (dot) dot.className = "dot dot-hollow";
    }
  });
}

/**
 * Build the 10 emotion rows from the registry.
 * The `vrm_expression` hint shown per row is the *registry* mapping, NOT the
 * runtime-resolved key (renderer does not expose the resolved key — acceptable for v0).
 */
function buildEmotionList(
  emotionsRegistry: EmotionRegistry,
  doSetEmotion: (id: EmotionId) => void,
): void {
  emotionList.innerHTML = "";

  for (const id of EMOTION_ORDER) {
    const entry = emotionsRegistry[id];

    const row = document.createElement("div");
    row.className = "motion-row";
    row.dataset["emotionId"] = id;
    row.tabIndex = 0;
    row.setAttribute("role", "row");

    // Dot
    const dot = document.createElement("span");
    dot.className = "dot dot-hollow";

    // Name
    const name = document.createElement("span");
    name.className = "row-name";
    name.textContent = id;

    // Registry expression hint tag (static — registry mapping, not resolved key)
    const tags = document.createElement("div");
    tags.className = "row-tags";
    if (entry) {
      const tagExpr = document.createElement("span");
      tagExpr.className = "tag";
      tagExpr.textContent = entry.vrm_expression;
      tags.appendChild(tagExpr);
    }

    // Play button
    const playBtn = document.createElement("button");
    playBtn.className = "btn-play";
    playBtn.title = "set emotion";
    playBtn.setAttribute("aria-label", `Set emotion ${id}`);
    playBtn.textContent = "▶";

    row.appendChild(dot);
    row.appendChild(name);
    row.appendChild(tags);
    row.appendChild(playBtn);
    emotionList.appendChild(row);

    // Row click / keyboard handler
    const handleSet = (): void => {
      doSetEmotion(id);
    };
    row.addEventListener("click", handleSet);
    row.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleSet();
      }
    });
    playBtn.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      handleSet();
    });
  }
}

// ─── FPS counter + elapsed timer ─────────────────────────────────────────────

let fpsFrames = 0;
let fpsLast = performance.now();

function rafLoop(): void {
  requestAnimationFrame(rafLoop);
  fpsFrames++;
  const now = performance.now();
  if (now - fpsLast >= 500) {
    state.fps = Math.round((fpsFrames * 1000) / (now - fpsLast));
    fpsFrames = 0;
    fpsLast = now;
  }

  const elapsedSec =
    state.activeId !== null
      ? ((performance.now() - state.elapsedStart) / 1000).toFixed(1)
      : "0.0";

  statusElapsed.textContent = `${elapsedSec}s`;
  statusFps.textContent = `${state.fps}fps`;
  const emotionHint = activeEmotionId !== null ? ` · em:${activeEmotionId}` : "";
  viewportStatus.textContent = `${state.activeId ?? "none"}${emotionHint} · ${state.fps}fps`;
}

// ─── Slider display updates ───────────────────────────────────────────────────

function formatSpeed(v: number): string {
  const s = v.toFixed(2).replace(/\.?0+$/, "");
  return `${s}x`;
}

slSpeed.addEventListener("input", () => {
  valSpeed.textContent = formatSpeed(parseFloat(slSpeed.value));
});

slFade.addEventListener("input", () => {
  valFade.textContent = `${slFade.value}ms`;
});

slIntensity.addEventListener("input", () => {
  valIntensity.textContent = parseFloat(slIntensity.value).toFixed(2);
});

slTransition.addEventListener("input", () => {
  valTransition.textContent = `${slTransition.value}ms`;
});

// ─── Main (async init) ────────────────────────────────────────────────────────
// Structured as an async function so the registry fetch completes before any
// code that depends on it runs. All init that needs the registry is inside here.

async function main(): Promise<void> {
  // 1. Fetch both registries at runtime (static import breaks the ES module
  //    graph — see module-level comment for the full explanation).
  let motionsRegistry: MotionRegistry;
  let emotionsRegistry: EmotionRegistry;
  try {
    const [motionsRes, emotionRes] = await Promise.all([
      fetch(CONFIG_URL),
      fetch(EMOTION_CONFIG_URL),
    ]);
    if (!motionsRes.ok) {
      throw new Error(`HTTP ${motionsRes.status} ${motionsRes.statusText} (motions)`);
    }
    if (!emotionRes.ok) {
      throw new Error(`HTTP ${emotionRes.status} ${emotionRes.statusText} (emotions)`);
    }
    motionsRegistry = (await motionsRes.json()) as MotionRegistry;
    emotionsRegistry = (await emotionRes.json()) as EmotionRegistry;
  } catch (err) {
    log.error("registry load failed:", err);
    viewportStatus.textContent = "registry load failed";
    return;
  }

  // 2. Create renderer with both registries injected.
  const renderer = createRenderer({
    mount,
    motionRegistry: motionsRegistry,
    emotionRegistry: emotionsRegistry,
  });

  // ─── Playback helpers (close over registry + renderer) ──────────────────────

  function currentSignalOverrides(): Partial<MotionSignal> {
    return {
      loop: cbLoop.checked,
      speed: parseFloat(slSpeed.value),
      fade_ms: parseInt(slFade.value, 10),
    };
  }

  function doPlayById(id: string): void {
    const overrides = currentSignalOverrides();
    const signal: MotionSignal = { id, ...overrides };
    renderer.playMotion(signal);
    state.activeId = id;
    state.elapsedStart = performance.now();
    setActiveRow(id);
    updateStatusBar();
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

  // ─── Emotion helpers (close over emotionsRegistry + renderer) ───────────────

  function doSetEmotion(id: EmotionId): void {
    renderer.setEmotion({
      id,
      intensity: parseFloat(slIntensity.value),
      transition_ms: parseInt(slTransition.value, 10),
    });
    activeEmotionId = id;
    setActiveEmotionRow(id);
  }

  // ─── Status bar ─────────────────────────────────────────────────────────────

  function updateStatusBar(): void {
    if (state.activeId === null) {
      statusNow.textContent = "none";
      statusKind.textContent = "-";
      statusPriority.textContent = "-";
      return;
    }
    const entry = motionsRegistry[state.activeId];
    statusNow.textContent = state.activeId;
    statusKind.textContent = entry ? entry.kind : "-";
    statusPriority.textContent = entry ? `p${entry.priority}` : "-";
  }

  // 3. Build the registry list + crossfade dropdown (needs registry).
  buildRegistryList(motionsRegistry, doPlayById);
  buildCrossfadeOptions(motionsRegistry);

  // 4. Build emotion rows from the emotion registry.
  buildEmotionList(emotionsRegistry, doSetEmotion);

  // 5. Wire motion action buttons (close over doPlayById/doStop/doIdleReturn).
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

  // 6. Wire emotion action buttons.
  // btn-neutral: the ONLY explicit-neutral path — always sets {id:"neutral"}.
  btnNeutral.addEventListener("click", () => {
    renderer.setEmotion({ id: "neutral" });
    activeEmotionId = "neutral";
    setActiveEmotionRow("neutral");
  });

  // btn-hold: demonstrates the hold-on-null no-op (renderer keeps previous expression).
  btnHold.addEventListener("click", () => {
    renderer.setEmotion(null);
    // null is a no-op in the renderer — do not change activeEmotionId or row highlight.
  });

  // 7. Start rAF loop for fps/elapsed display.
  requestAnimationFrame(rafLoop);

  // dev-only perch hook: drive setPerchTarget from Playwright / console.
  //   window.__perch(yPx) → pin the seat to that pet-window-local y line.
  //   window.__perch(null) → exit perch, restore idle framing.
  //   window.__perchProbe() → one-shot seat/charH probe.
  Object.assign(globalThis as Record<string, unknown>, {
    __perch: (yPx: number | null): void =>
      renderer.setPerchTarget(yPx === null ? null : { edgeLocalYpx: yPx }),
    __perchProbe: () => renderer.getPerchProbe(),
    __yuiRenderer: renderer,
  });

  // 8. Load VRM — renderer auto-plays idle baseline on load.
  try {
    await renderer.loadVRM(VRM_URL);
    // Reflect idle baseline in UI state (renderer sets it on load when registry is set)
    state.activeId = "idle";
    state.elapsedStart = performance.now();
    setActiveRow("idle");
    updateStatusBar();
  } catch (err) {
    log.error("VRM load failed:", err);
  }
}

void main();
