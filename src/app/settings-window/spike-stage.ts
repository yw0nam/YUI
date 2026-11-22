/**
 * SPIKE #2035 (never merged): option B, a second VRM render on a stage pane at the settings window's left.
 *
 * On when localStorage `spike.stage` is `"render"`. Hard-coded 300 px stage; the panel shifts right.
 * Answers `spike://ask` with its frame times and directive latencies, read by a WebDriver scenario from main.
 */

import { resolveAssetUrl } from "../../config/asset-url";
import { createConfigStore } from "../../config/store";
import type { ControlEnvelope } from "../../contract";
import { createLogger } from "../../logger";
import { createRenderer } from "../../renderer";
import { isTauri } from "../../tauri-env";

const log = createLogger("spike-stage");

const STAGE_WIDTH_PX = 300;

type SpikeStats = { visibility: string; ticks: number[]; latencies: number[]; motion: unknown };

/**
 * Answers `spike://ask` from the pet window with `spike://stats`, so a scenario reads this window without a
 * WebDriver window switch (the embedded driver's switch failed on about a third of the launches).
 */
async function answerAsks(stats: () => Omit<SpikeStats, "visibility">): Promise<void> {
  if (!isTauri()) return;
  const { listen, emit } = await import("@tauri-apps/api/event");
  await listen("spike://ask", () => {
    void emit("spike://stats", { visibility: document.visibilityState, ...stats() });
  });
}

export async function mountSpikeStage(app: HTMLElement): Promise<void> {
  const flag = localStorage.getItem("spike.stage");
  if (flag !== "render" && flag !== '"render"') {
    await answerAsks(() => ({ ticks: [], latencies: [], motion: null }));
    return;
  }

  const stage = document.createElement("div");
  Object.assign(stage.style, {
    position: "fixed",
    left: "0",
    top: "0",
    bottom: "0",
    width: `${STAGE_WIDTH_PX}px`,
    background: "transparent",
  });
  document.body.appendChild(stage);
  app.style.marginLeft = `${STAGE_WIDTH_PX}px`;

  const config = await createConfigStore().load();
  const renderer = createRenderer({
    mount: stage,
    motionRegistry: config.motions,
    emotionRegistry: config.emotionRegistry,
    framing: config.avatar.framing,
    gaze: config.avatar.gaze,
    hitTestThreshold: config.avatar.hit_test.alpha_threshold,
  });

  // Rendered-frame timestamps (the renderer's own tick, so the idle 30 fps gate is counted as the pet's is).
  const ticks: number[] = [];
  renderer.onTick(() => {
    ticks.push(performance.now());
    if (ticks.length > 2000) ticks.shift();
  });

  // Directive mirror: the pet would emit what it applies; here a scenario emits it with its send time.
  const latencies: number[] = [];
  if (isTauri()) {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ sentAt: number; env: ControlEnvelope }>("spike://directive", (event) => {
      latencies.push(Date.now() - event.payload.sentAt);
      renderer.applyDirective(event.payload.env);
    });
  }

  const t0 = performance.now();
  await renderer.loadVRM(await resolveAssetUrl(config.avatar.vrm_url));
  log.info("spike_stage_vrm_loaded", { ms: Math.round(performance.now() - t0) });

  await answerAsks(() => ({
    ticks: ticks.slice(),
    latencies: latencies.slice(),
    motion: renderer.getCurrentMotion(),
  }));
}
