/**
 * Motion and emotion preview, lazy-loaded by the Developer Tools window.
 *
 * Architecture:
 *   - Loads validated runtime config through createConfigStore.
 *   - Resolves the configured VRM through resolveAssetUrl.
 *   - Registry list is grouped by MotionKind.
 *   - Playback controls compose RenderMotionSignal overrides passed to renderer.playMotion().
 *
 * Status bar polls renderer.getCurrentMotion() per frame, so it reflects the committed
 * motion including variant resolution and oneshot auto-return-to-idle.
 */

import "./motion-preview.css";
import { createConfigStore } from "../../config";
import type { EmotionId, EmotionRegistry, MotionKind, MotionRegistry } from "../../contract";
import { resolveAssetUrl } from "../../io/asset-url";
import { createLogger } from "../../logger";
import { createRenderer, type RenderMotionSignal } from "../../renderer";

const log = createLogger("motion-preview");

// ─── Motion kind display order ────────────────────────────────────────────────
const KIND_ORDER: MotionKind[] = ["ambient", "reactive", "state", "oneshot"];

// ─── Emotion display order (matches the emotion vocabulary) ───────────────
const EMOTION_ORDER: EmotionId[] = [
  "neutral",
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "thinking",
  "curious",
  "sleepy",
  "embarrassed",
];

// ─── State ───────────────────────────────────────────────────────────────────

interface PlaybackState {
  /** ID of the committed motion (synced from renderer.getCurrentMotion each frame). */
  activeId: string | null;
  /** Elapsed seconds since last play action. */
  elapsedStart: number;
  /** Live fps from rAF counter. */
  fps: number;
}

/** "/motions/idle_03.vrma" → "idle_03" */
function variantName(vrmaPath: string): string {
  return vrmaPath.slice(vrmaPath.lastIndexOf("/") + 1).replace(/\.vrma$/, "");
}

/**
 * Preview-only: expand each pooled entry's variants into individually playable
 * single-vrma entries (idle_01, sit_02, …) inserted right after their pool, so a
 * specific variant can be selected directly instead of via the pool's random pick.
 */
function expandVariantEntries(reg: MotionRegistry): {
  registry: MotionRegistry;
  variantIds: Set<string>;
} {
  const out: MotionRegistry = {};
  const variantIds = new Set<string>();
  for (const [id, entry] of Object.entries(reg)) {
    out[id] = entry;
    if (!entry.variants || entry.variants.length === 0) continue;
    for (const v of entry.variants) {
      const childId = variantName(v);
      if (reg[childId] || out[childId]) continue;
      const {
        variants: _v,
        variant_policy: _p,
        loop_cycles: _l,
        cycle_dwell_ms: _c,
        ...rest
      } = entry;
      out[childId] = { ...rest, vrma_path: v };
      variantIds.add(childId);
    }
  }
  return { registry: out, variantIds };
}

/** Format a playback speed multiplier for display, e.g. 1.5 → "1.5x". */
function formatSpeed(v: number): string {
  const s = v.toFixed(2).replace(/\.?0+$/, "");
  return `${s}x`;
}

/**
 * Mounts the motion/emotion preview into `mount`, replacing its contents.
 * Loads the motion + emotion registries and the configured VRM, then wires
 * playback controls to a fresh renderer instance.
 *
 * Throws if the registry/config load fails — the caller (devtools shell)
 * renders an error state and lets the user retry by re-activating the tab.
 */
export async function mountMotionPreview(mount: HTMLElement): Promise<{ dispose(): void }> {
  mount.className = "devtools-panel motion-preview";
  mount.innerHTML = `
    <div class="motion-preview__viewport">
      <div class="viewport-label">VRM Viewport</div>
      <div id="vrm-mount"></div>
      <div class="viewport-status" id="viewport-status">idle · 0fps</div>
    </div>
    <div class="motion-preview__rail">
      <div class="rail-scroll">
        <div class="section">
          <div class="section-header"><span class="section-label">Registry</span><div class="section-divider"></div></div>
          <div id="registry-list"></div>
        </div>
        <div class="section-sep"></div>
        <div class="playback-section">
          <div class="section-header"><span class="section-label">Playback</span><div class="section-divider"></div></div>
          <div class="playback-row"><span class="playback-label">loop</span><div class="playback-control"><label class="cb-wrap"><input type="checkbox" id="cb-loop" checked /><span class="cb-label">enabled</span></label></div></div>
          <div class="playback-row"><span class="playback-label">speed</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-speed" min="0.25" max="2.5" step="0.05" value="1.0" /><span class="slider-value" id="val-speed">1x</span></div></div></div>
          <div class="playback-row"><span class="playback-label">fade</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-fade" min="0" max="600" step="10" value="200" /><span class="slider-value" id="val-fade">200ms</span></div></div></div>
          <div class="playback-row"><span class="playback-label">crossfade →</span><div class="playback-control"><select id="sel-crossfade"></select></div></div>
          <div class="btn-row"><button class="btn btn-primary" id="btn-play">play</button><button class="btn btn-stop" id="btn-stop">stop</button><button class="btn btn-idle" id="btn-idle">→ idle</button></div>
        </div>
        <div class="section-sep"></div>
        <div class="section">
          <div class="section-header"><span class="section-label">Emotion</span><div class="section-divider"></div></div>
          <div id="emotion-list"></div>
          <div class="playback-row"><span class="playback-label">intensity</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-intensity" min="0" max="1" step="0.05" value="1" /><span class="slider-value" id="val-intensity">1.00</span></div></div></div>
          <div class="playback-row"><span class="playback-label">transition</span><div class="playback-control"><div class="slider-wrap"><input type="range" id="sl-transition" min="0" max="1000" step="10" value="250" /><span class="slider-value" id="val-transition">250ms</span></div></div></div>
          <div class="btn-row"><button class="btn btn-primary" id="btn-neutral">→ neutral</button><button class="btn btn-stop" id="btn-hold">hold (null)</button></div>
        </div>
      </div>
      <div class="status-bar"><span class="status-text"><span class="status-key">now: </span><span class="status-accent" id="status-now">loading</span><span class="status-key"> · </span><span class="status-val" id="status-kind">-</span><span class="status-key"> · </span><span class="status-val" id="status-priority">-</span><span class="status-key"> · </span><span class="status-val" id="status-elapsed">0.0s</span><span class="status-key"> · </span><span class="status-val" id="status-fps">0fps</span></span></div>
    </div>
  `;

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
  /** ID of the emotion the user last applied (or null if none applied yet). */
  let activeEmotionId: EmotionId | null = null;
  let fpsFrames = 0;
  let fpsLast = performance.now();
  let rafId = 0;

  // ─── DOM refs ─────────────────────────────────────────────────────────────

  const vrmMount = mount.querySelector("#vrm-mount") as HTMLDivElement;
  const registryList = mount.querySelector("#registry-list") as HTMLDivElement;
  const cbLoop = mount.querySelector("#cb-loop") as HTMLInputElement;
  const slSpeed = mount.querySelector("#sl-speed") as HTMLInputElement;
  const valSpeed = mount.querySelector("#val-speed") as HTMLSpanElement;
  const slFade = mount.querySelector("#sl-fade") as HTMLInputElement;
  const valFade = mount.querySelector("#val-fade") as HTMLSpanElement;
  const selCrossfade = mount.querySelector("#sel-crossfade") as HTMLSelectElement;
  const btnPlay = mount.querySelector("#btn-play") as HTMLButtonElement;
  const btnStop = mount.querySelector("#btn-stop") as HTMLButtonElement;
  const btnIdle = mount.querySelector("#btn-idle") as HTMLButtonElement;
  const statusNow = mount.querySelector("#status-now") as HTMLSpanElement;
  const statusKind = mount.querySelector("#status-kind") as HTMLSpanElement;
  const statusPriority = mount.querySelector("#status-priority") as HTMLSpanElement;
  const statusElapsed = mount.querySelector("#status-elapsed") as HTMLSpanElement;
  const statusFps = mount.querySelector("#status-fps") as HTMLSpanElement;
  const viewportStatus = mount.querySelector("#viewport-status") as HTMLSpanElement;

  // ─── Emotion DOM refs ─────────────────────────────────────────────────────
  const emotionList = mount.querySelector("#emotion-list") as HTMLDivElement;
  const slIntensity = mount.querySelector("#sl-intensity") as HTMLInputElement;
  const valIntensity = mount.querySelector("#val-intensity") as HTMLSpanElement;
  const slTransition = mount.querySelector("#sl-transition") as HTMLInputElement;
  const valTransition = mount.querySelector("#val-transition") as HTMLSpanElement;
  const btnNeutral = mount.querySelector("#btn-neutral") as HTMLButtonElement;
  const btnHold = mount.querySelector("#btn-hold") as HTMLButtonElement;

  /** Sync row highlight / status bar / idle sub-line to the committed motion. */
  function syncLiveMotion(): { id: string; vrma_path: string } | null {
    const cur = liveMotion?.() ?? null;
    const key = cur ? `${cur.id}|${cur.vrma_path}` : "";
    if (key === lastLiveKey) return cur;
    lastLiveKey = key;

    state.activeId = cur?.id ?? null;
    state.elapsedStart = performance.now(); // per-clip: resets on variant swap too

    setActiveRow(cur?.id ?? null);

    const entry = cur && liveRegistry ? liveRegistry[cur.id] : undefined;
    statusNow.textContent = cur ? cur.id : "none";
    statusKind.textContent = entry ? entry.kind : "-";
    statusPriority.textContent = entry ? `p${entry.priority}` : "-";

    const subLine = mount.querySelector("#idle-sub-line");
    const variants = liveRegistry?.idle?.variants;
    if (subLine && cur && cur.id === "idle" && variants) {
      const idx = variants.indexOf(cur.vrma_path);
      if (idx >= 0) {
        subLine.innerHTML = `variant <span>${idx + 1}/${variants.length}</span> &middot; ${variantName(cur.vrma_path)}`;
      }
    }
    return cur;
  }

  // ─── Registry list rendering ──────────────────────────────────────────────

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
      const rowId = row.dataset.motionId;
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
    variantIds: Set<string> = new Set(),
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
        row.className = variantIds.has(id) ? "motion-row variant-row" : "motion-row";
        row.dataset.motionId = id;
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
      const rowId = row.dataset.emotionId as EmotionId | undefined;
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
   * runtime-resolved key (renderer does not expose the resolved key).
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
      row.dataset.emotionId = id;
      row.tabIndex = 0;
      row.setAttribute("role", "row");

      // Dot
      const dot = document.createElement("span");
      dot.className = "dot dot-hollow";

      // Name
      const name = document.createElement("span");
      name.className = "row-name";
      name.textContent = id;

      // Registry expression hint tag (registry mapping, not resolved key)
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
    const emotionHint = activeEmotionId !== null ? ` · em:${activeEmotionId}` : "";
    viewportStatus.textContent = `${cur?.id ?? "none"}${variantHint}${emotionHint} · ${state.fps}fps`;
  }

  // ─── Slider display updates ─────────────────────────────────────────────

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

  // ─── Registry + VRM load ──────────────────────────────────────────────────

  let motionsRegistry: MotionRegistry;
  let emotionsRegistry: EmotionRegistry;
  let vrmUrl: string;
  try {
    const config = await createConfigStore().load();
    motionsRegistry = config.motions;
    emotionsRegistry = config.emotionRegistry;
    vrmUrl = await resolveAssetUrl(config.avatar.vrm_url);
  } catch (err) {
    log.error("registry_load_failed", { error: String(err) });
    throw err;
  }

  // Expand pooled variants into directly selectable entries (preview-only).
  const { registry: expandedRegistry, variantIds } = expandVariantEntries(motionsRegistry);

  // Create renderer with both registries injected.
  const renderer = createRenderer({
    mount: vrmMount,
    motionRegistry: expandedRegistry,
    emotionRegistry: emotionsRegistry,
  });

  // ─── Playback helpers (close over registry + renderer) ──────────────────

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
    // Row highlight / status bar follow via syncLiveMotion polling in rafLoop.
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

  // ─── Emotion helpers (close over emotionsRegistry + renderer) ───────────

  function doSetEmotion(id: EmotionId): void {
    renderer.setEmotion({
      id,
      intensity: parseFloat(slIntensity.value),
      transition_ms: parseInt(slTransition.value, 10),
    });
    activeEmotionId = id;
    setActiveEmotionRow(id);
  }

  // Build the registry list + crossfade dropdown (needs registry).
  buildRegistryList(expandedRegistry, doPlayById, variantIds);
  buildCrossfadeOptions(expandedRegistry);

  // Build emotion rows from the emotion registry.
  buildEmotionList(emotionsRegistry, doSetEmotion);

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

  // Wire emotion action buttons.
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

  // Start rAF loop for fps/elapsed/current-motion display.
  liveMotion = () => renderer.getCurrentMotion();
  liveRegistry = expandedRegistry;
  rafId = requestAnimationFrame(rafLoop);

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

  // Load VRM — renderer auto-plays idle baseline on load.
  try {
    await renderer.loadVRM(vrmUrl);
    // Idle baseline auto-plays on load; syncLiveMotion picks it up next frame.
  } catch (err) {
    log.error("vrm_load_failed", { error: String(err) });
  }

  return {
    dispose() {
      cancelAnimationFrame(rafId);
      renderer.dispose();
    },
  };
}
