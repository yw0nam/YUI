// SPIKE #1971 (never merged): helpers for the scenario modules (run by scenario-run.sh in node).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import readline from "node:readline";

export const PROBE = `${process.env.SPIKE_SCRATCH}/probe`;
const EXE_RE = /YUI Verify\.app\/Contents\/MacOS\/app$/;

/** WebKit helper processes on this Mac: {pid, kind}. */
export function webkitPids() {
  let out = "";
  try {
    out = execFileSync("pgrep", ["-f", "com.apple.WebKit.(WebContent|GPU)"], { encoding: "utf8" });
  } catch {}
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((pid) => {
      const cmd = execFileSync("ps", ["-o", "command=", "-p", pid], { encoding: "utf8" });
      return { pid: Number(pid), kind: /WebKit\.GPU/.test(cmd) ? "gpu" : "web" };
    });
}

/** The WebKit pids that were not alive before the app launched (SPIKE_PRE holds that list). */
export function appWebkitPids() {
  const pre = new Set(JSON.parse(fs.readFileSync(process.env.SPIKE_PRE, "utf8")));
  return webkitPids().filter((p) => !pre.has(p.pid));
}

/** The verify app's own process: the executable of this worktree's bundle. */
export function appPid() {
  const wt = process.env.E2E_WT;
  const out = execFileSync("pgrep", ["-f", `^${wt}/src-tauri/target/debug/bundle/macos/YUI Verify.app/Contents/MacOS/app`], {
    encoding: "utf8",
  });
  return Number(out.trim().split("\n")[0]);
}

export function footprintMb(pid) {
  const out = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8" });
  const m = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(out);
  return m ? Number(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]] : null;
}

export function cpuSec(pid) {
  const t = execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** Accumulated GPU time (ns) per pid, from the AGX user clients' AppUsage (what Activity Monitor's GPU column reads). */
export function gpuTimeNs() {
  const out = execFileSync("ioreg", ["-l", "-w0", "-r", "-c", "AGXDeviceUserClient"], { encoding: "utf8", maxBuffer: 64 << 20 });
  const per = {};
  for (const block of out.split(/\+-o AGXDeviceUserClient/)) {
    const pid = /"IOUserClientCreator" = "pid (\d+)/.exec(block)?.[1];
    if (!pid) continue;
    for (const m of block.matchAll(/"accumulatedGPUTime"=(\d+)/g)) per[pid] = (per[pid] ?? 0) + Number(m[1]);
  }
  return per;
}

export function windowServerPid() {
  return Number(execFileSync("pgrep", ["-x", "WindowServer"], { encoding: "utf8" }).trim().split("\n")[0]);
}

/** Device utilization % of the GPU (whole machine). */
export function gpuDeviceUtil() {
  const out = execFileSync("ioreg", ["-r", "-d", "1", "-c", "IOAccelerator", "-w0"], { encoding: "utf8" });
  return Number(/"Device Utilization %"=(\d+)/.exec(out)?.[1] ?? NaN);
}

export function loadAvg1() {
  return Number(execFileSync("sysctl", ["-n", "vm.loadavg"], { encoding: "utf8" }).trim().split(/\s+/)[1]);
}

/** The probe helper process: send(cmd) resolves with its one JSON answer line. */
export function startProbe() {
  const child = spawn(PROBE, [], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = readline.createInterface({ input: child.stdout });
  const waiting = [];
  let ready;
  const readyP = new Promise((r) => (ready = r));
  rl.on("line", (line) => {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (o.ready) return ready(o);
    waiting.shift()?.(o);
  });
  const send = (cmd) =>
    new Promise((resolve) => {
      waiting.push(resolve);
      child.stdin.write(`${cmd}\n`);
    });
  return {
    pid: child.pid,
    ready: readyP,
    send,
    quit: () => {
      child.stdin.write("quit\n");
      setTimeout(() => {
        try {
          process.kill(child.pid);
        } catch {}
      }, 1500);
    },
  };
}

export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))] : null;
};
export const median = (xs) => pct(xs.filter((x) => x != null), 50);

/** In-page call on window.__spike. */
export const S = (expr) => `(async () => { const s = window.__spike; if (!s) return { error: "no __spike" }; return await (${expr}); })()`;
export { EXE_RE };
