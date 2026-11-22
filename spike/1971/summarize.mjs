// SPIKE #1971 (never merged): medians over the cost launches.  node summarize.mjs <cost-dir>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const med = (xs) => {
  const s = xs.filter((x) => x != null && !Number.isNaN(x)).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const runs = { base: [], stage: [] };
const rejected = [];
for (const d of fs.readdirSync(dir).sort()) {
  const f = path.join(dir, d, "result.json");
  if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  const s = r.steps;
  const ok = s.sample && s.visibility === "visible" && s.native?.ignores_mouse === true;
  if (!ok) {
    rejected.push({ run: d, error: r.error?.slice(0, 120), visibility: s.visibility, ignores: s.native?.ignores_mouse });
    continue;
  }
  runs[s.mode].push({ run: d, ...s.sample, frame: `${s.frame.w}x${s.frame.h}@${s.frame.scale} canvas ${s.frame.canvas}` });
}
const keys = [
  "frames_10s", "web_mb", "gpu_proc_mb", "app_mb", "total_mb", "web_cpu_pct", "gpu_proc_cpu_pct", "app_cpu_pct",
  "gpu_proc_gpu_ms_per_s", "windowserver_gpu_ms_per_s", "machine_gpu_util_pct_median", "load1",
];
const table = {};
for (const [mode, list] of Object.entries(runs)) {
  table[`${mode} n=${list.length}`] = Object.fromEntries(keys.map((k) => [k, med(list.map((s) => s[k]))]));
  table[`${mode} frame`] = [...new Set(list.map((s) => s.frame))];
}
const b = table[`base n=${runs.base.length}`];
const st = table[`stage n=${runs.stage.length}`];
table.ratio_stage_over_base = Object.fromEntries(
  keys.filter((k) => b[k]).map((k) => [k, Math.round((st[k] / b[k]) * 100) / 100]),
);
table.per_run = Object.fromEntries(
  ["web_mb", "gpu_proc_mb", "web_cpu_pct", "gpu_proc_gpu_ms_per_s", "windowserver_gpu_ms_per_s", "frames_10s"].map((k) => [
    k,
    Object.fromEntries(Object.entries(runs).map(([m, l]) => [m, l.map((s) => s[k])])),
  ]),
);
table.rejected = rejected;
console.log(JSON.stringify(table, null, 1));
