// SPIKE #2035 option B cost: one launch. SPIKE_MODE=base (settings without a stage) or stage (seed spike.stage).
// Pet floats at (60,150) 400x600, settings at (500,100) 760x680, side by side so neither occludes the other.
// Every read runs in main: settings answers `spike://ask` (WebDriver window switches failed on ~1/3 of launches).
import { appPids, cpuSec, FOCUS_SETTINGS, footprintMb, MOVE_PET, ON_TOP, OPEN_SETTINGS, pct } from "./lib.mjs";

const MODE = process.env.SPIKE_MODE;

const ASK = `new Promise(async (resolve) => {
  const ev = window.__TAURI__.event;
  const un = await ev.listen("spike://stats", (e) => { un(); resolve(e.payload); });
  await ev.emit("spike://ask");
  setTimeout(() => resolve(null), 3000);
})`;

async function sample(h, settingsPid, label) {
  const pids = appPids();
  const foot = Object.fromEntries(pids.map((p) => [p.pid, { kind: p.kind, mb: footprintMb(p.pid) }]));
  const c0 = Object.fromEntries(pids.map((p) => [p.pid, cpuSec(p.pid)]));
  const t0 = Date.now();
  await h.sleep(10000);
  const secs = (Date.now() - t0) / 1000;
  const cpu = Object.fromEntries(pids.map((p) => [p.pid, Math.round(((cpuSec(p.pid) - c0[p.pid]) / secs) * 1000) / 10]));
  const sum = (kind, f) => pids.filter((p) => kind(p)).reduce((a, p) => a + f(p.pid), 0);
  return {
    label,
    settings_wc_mb: foot[settingsPid]?.mb,
    other_wc_mb: sum((p) => p.kind === "web" && p.pid !== settingsPid, (pid) => foot[pid].mb),
    gpu_mb: sum((p) => p.kind === "gpu", (pid) => foot[pid].mb),
    total_mb: sum(() => true, (pid) => foot[pid].mb),
    settings_wc_cpu_pct: cpu[settingsPid],
    other_wc_cpu_pct: sum((p) => p.kind === "web" && p.pid !== settingsPid, (pid) => cpu[pid]),
    gpu_cpu_pct: sum((p) => p.kind === "gpu", (pid) => cpu[pid]),
  };
}

function frames(stats) {
  const ticks = stats?.ticks ?? [];
  if (!ticks.length) return null;
  const last = ticks.filter((t) => t > ticks[ticks.length - 1] - 10000);
  const iv = last.slice(1).map((t, i) => t - last[i]);
  return { frames_10s: last.length, p50_ms: pct(iv, 50), p95_ms: pct(iv, 95) };
}

export default async function (h, steps) {
  steps.mode = MODE;
  steps.on_top = await h.exec(ON_TOP(true));
  steps.pet_moved = await h.exec(MOVE_PET(60, 150));
  const before = new Set(appPids().map((p) => p.pid));
  const m = h.mark();
  steps.open = await h.exec(OPEN_SETTINGS(500, 100));
  let settingsPid = null;
  for (let i = 0; i < 50 && !settingsPid; i++) {
    await h.sleep(200);
    settingsPid = appPids().find((p) => p.kind === "web" && !before.has(p.pid))?.pid ?? null;
  }
  steps.settings_pid = settingsPid;
  if (MODE === "stage") steps.stage_loaded = await h.nextLine(/spike_stage_vrm_loaded/, m, 30000);
  await h.sleep(1000);
  steps.focus = await h.exec(FOCUS_SETTINGS(true));
  await h.sleep(5000);
  steps.settings_visibility = (await h.exec(ASK))?.visibility ?? null;
  steps.pet_visibility = await h.exec("document.visibilityState");
  steps.shown = await sample(h, settingsPid, "pet shown");
  if (MODE !== "stage") return;
  steps.stage_frames_pet_shown = frames(await h.exec(ASK));

  // Option B as shipped would hide the pet while she stands in the stage.
  steps.pet_hide = await h.exec("window.__TAURI__.window.getCurrentWindow().hide().then(() => 'hidden')");
  await h.sleep(3000);
  steps.pet_visibility_hidden = await h.exec("document.visibilityState");
  steps.hidden = await sample(h, settingsPid, "pet hidden");
  steps.stage_frames_pet_hidden = frames(await h.exec(ASK));
  // Directive mirror (last: it starts a motion, which lifts the idle frame cap) over a Tauri event: 50 sends from the pet window, 50 ms apart.
  steps.directive = await h.exec(`(async () => {
    for (let i = 0; i < 50; i++) {
      await window.__TAURI__.event.emit("spike://directive", { sentAt: Date.now(),
        env: i === 49 ? { emotion: { id: "happy" }, motion: { id: "happy" }, speech_text: "" } : { speech_text: "" } });
      await new Promise((r) => setTimeout(r, 50));
    }
    return "sent";
  })()`);
  await h.sleep(500);
  const st = await h.exec(ASK);
  const lat = st?.latencies ?? [];
  steps.stage_motion_after_directive = st?.motion ?? null;
  steps.directive_latency_ms = { n: lat.length, p50: pct(lat, 50), p95: pct(lat, 95), max: Math.max(...lat) };

}
