// SPIKE #2035: medians over the cost launches.  node summarize.mjs <cost-dir>
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2];
const med = (xs) => {
  const s = xs.filter((x) => x != null).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const runs = { base: [], stage: [] };
for (const d of fs.readdirSync(dir)) {
  const f = path.join(dir, d, "result.json");
  if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, "utf8"));
  // A run that failed after its "pet shown" sample (a WebDriver window switch) keeps that sample.
  if (!r.steps.shown || r.steps.settings_visibility !== "visible") continue;
  runs[r.steps.mode].push(r.steps);
}
const keys = ["settings_wc_mb", "other_wc_mb", "gpu_mb", "total_mb", "settings_wc_cpu_pct", "other_wc_cpu_pct", "gpu_cpu_pct"];
const table = {};
for (const [mode, list] of Object.entries(runs)) {
  table[`${mode} n=${list.length}`] = Object.fromEntries(keys.map((k) => [k, med(list.map((s) => s.shown[k]))]));
  if (mode === "stage") {
    // First-version runs sampled "pet hidden" after the directive test, whose motion lifts the idle cap; only
    // the second version (no per_pid field) samples it idle.
    const idle = list.filter((x) => !x.shown.per_pid);
    table[`stage, pet hidden n=${idle.length}`] = Object.fromEntries(keys.map((k) => [k, med(idle.map((s) => s.hidden?.[k]))]));
    table.stage_frames_pet_shown = {
      frames_10s: med(list.map((s) => s.stage_frames_pet_shown?.frames_10s)),
      p50_ms: med(list.map((s) => s.stage_frames_pet_shown?.p50_ms)),
      p95_ms: med(list.map((s) => s.stage_frames_pet_shown?.p95_ms)),
    };
    table.stage_frames_pet_hidden = {
      frames_10s: med(idle.map((s) => s.stage_frames_pet_hidden?.frames_10s)),
      p50_ms: med(idle.map((s) => s.stage_frames_pet_hidden?.p50_ms)),
      p95_ms: med(idle.map((s) => s.stage_frames_pet_hidden?.p95_ms)),
    };
    table.directive_latency_ms = {
      p50: med(list.map((s) => s.directive_latency_ms?.p50)),
      p95: med(list.map((s) => s.directive_latency_ms?.p95)),
      max: Math.max(...list.map((s) => s.directive_latency_ms?.max ?? 0)),
    };
    table.motion_after_directive = list.map((s) => s.stage_motion_after_directive?.id);
  }
}
table.per_run_settings_wc_mb = Object.fromEntries(Object.entries(runs).map(([m, l]) => [m, l.map((s) => s.shown.settings_wc_mb)]));
table.per_run_gpu_mb = Object.fromEntries(Object.entries(runs).map(([m, l]) => [m, l.map((s) => s.shown.gpu_mb)]));
console.log(JSON.stringify(table, null, 1));
