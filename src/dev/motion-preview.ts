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
import type { MotionRegistry, MotionKind, MotionSignal } from "../contract";

// ─── Runtime config URL (served by the custom dev middleware at /configs/*) ───
// Do NOT statically import — Vite rewrites JSON imports to ?import, the middleware
// returns raw JSON (not a JS module), and the browser rejects the whole ES module graph.
const CONFIG_URL = "/configs/motions.json";

// ─── VRM URL (configurable; default uses the gitignored symlink) ──────────────
const VRM_URL = "/vrms/carlotta.vrm";

// ─── Motion kind display order ────────────────────────────────────────────────
const KIND_ORDER: MotionKind[] = ["ambient", "reactive", "state", "oneshot"];

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
  viewportStatus.textContent = `${state.activeId ?? "none"} · ${state.fps}fps`;
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

// ─── Main (async init) ────────────────────────────────────────────────────────
// Structured as an async function so the registry fetch completes before any
// code that depends on it runs. All init that needs the registry is inside here.

async function main(): Promise<void> {
  // 1. Fetch the motion registry at runtime (static import breaks the ES module
  //    graph — see module-level comment for the full explanation).
  let motionsRegistry: MotionRegistry;
  try {
    const res = await fetch(CONFIG_URL);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    motionsRegistry = (await res.json()) as MotionRegistry;
  } catch (err) {
    console.error("[MotionPreview] registry load failed:", err);
    viewportStatus.textContent = "registry load failed";
    return;
  }

  // 2. Create renderer with the now-available registry.
  const renderer = createRenderer({ mount, motionRegistry: motionsRegistry });

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

  // 4. Wire action buttons (close over doPlayById/doStop/doIdleReturn).
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

  // 5. Start rAF loop for fps/elapsed display.
  requestAnimationFrame(rafLoop);

  // 6. Load VRM — renderer auto-plays idle baseline on load.
  try {
    await renderer.loadVRM(VRM_URL);
    // Reflect idle baseline in UI state (renderer sets it on load when registry is set)
    state.activeId = "idle";
    state.elapsedStart = performance.now();
    setActiveRow("idle");
    updateStatusBar();
  } catch (err) {
    console.error("[MotionPreview] VRM load failed:", err);
  }
}

void main();
