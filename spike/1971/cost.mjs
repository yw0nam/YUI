// SPIKE #1971 (never merged): render cost of one launch, SPIKE_MODE=base (400x600 window) or stage (monitor-sized
// window, same framing drawn at the same screen spot). Both float, both idle, both put the hit-test in passthrough
// (cursor poll every 33 ms) with a synthetic pointermove over a transparent pixel, then sample 10 s.
import {
  appPid,
  appWebkitPids,
  cpuSec,
  footprintMb,
  gpuDeviceUtil,
  gpuTimeNs,
  loadAvg1,
  S,
  startProbe,
  windowServerPid,
} from "./lib.mjs";

const MODE = process.env.SPIKE_MODE;

export default async function (h, steps) {
  const probe = startProbe();
  await probe.ready;
  steps.mode = MODE;
  steps.front_at_start = await probe.send("front");
  steps.config = await h.exec(S("s.config()"));
  await h.sleep(1500);
  steps.frame = await h.exec(S("s.frame()"));
  steps.passthrough_at = await h.exec(S("s.synthMove(395, 10, 3)"));
  await h.sleep(5000);
  steps.native = await h.exec(S('s.native("state")'));
  steps.visibility = await h.exec("document.visibilityState");

  const app = appPid();
  const ws = windowServerPid();
  const pids = [...appWebkitPids(), { pid: app, kind: "app" }];
  const c0 = Object.fromEntries(pids.map((p) => [p.pid, cpuSec(p.pid)]));
  const g0 = gpuTimeNs();
  const util = [];
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) {
    await h.sleep(1000);
    util.push(gpuDeviceUtil());
  }
  const secs = (Date.now() - t0) / 1000;
  const g1 = gpuTimeNs();
  const frames = await h.exec(S("s.frames(10000)"));
  const foot = Object.fromEntries(pids.map((p) => [p.pid, footprintMb(p.pid)]));
  const cpu = Object.fromEntries(pids.map((p) => [p.pid, Math.round(((cpuSec(p.pid) - c0[p.pid]) / secs) * 1000) / 10]));
  const gpuMs = (pid) => ((g1[pid] ?? 0) - (g0[pid] ?? 0)) / 1e6 / secs; // ms of GPU time per s
  const sum = (kind, f) => pids.filter((p) => p.kind === kind).reduce((a, p) => a + (f(p.pid) ?? 0), 0);
  steps.sample = {
    secs,
    frames_10s: frames.frames,
    frame_interval_ms: frames.interval_ms,
    web_mb: sum("web", (p) => foot[p]),
    gpu_proc_mb: sum("gpu", (p) => foot[p]),
    app_mb: foot[app],
    total_mb: pids.reduce((a, p) => a + (foot[p.pid] ?? 0), 0),
    web_cpu_pct: sum("web", (p) => cpu[p]),
    gpu_proc_cpu_pct: sum("gpu", (p) => cpu[p]),
    app_cpu_pct: cpu[app],
    gpu_proc_gpu_ms_per_s: Math.round(sum("gpu", gpuMs) * 100) / 100,
    windowserver_gpu_ms_per_s: Math.round(gpuMs(ws) * 100) / 100,
    machine_gpu_util_pct_median: [...util].sort((a, b) => a - b)[5],
    load1: loadAvg1(),
    per_pid: pids.map((p) => ({ ...p, mb: foot[p.pid], cpu: cpu[p.pid], gpu_ms_s: Math.round(gpuMs(p.pid) * 100) / 100 })),
  };
  steps.front_at_end = await probe.send("front");
  probe.quit();
}
