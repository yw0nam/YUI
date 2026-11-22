// SPIKE #2035: shared helpers for the scenario modules (run by scenario-run.sh in node).
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";

const SCRATCH = process.env.SPIKE_SCRATCH;
export const ZORDER = `${SCRATCH}/zorder`;
export const COVER = `${SCRATCH}/spike-cover`;

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
export function appPids() {
  const pre = new Set(JSON.parse(fs.readFileSync(process.env.SPIKE_PRE, "utf8")));
  return webkitPids().filter((p) => !pre.has(p.pid));
}

/** `footprint -p` total in MB. */
export function footprintMb(pid) {
  const out = execFileSync("footprint", ["-p", String(pid)], { encoding: "utf8" });
  const m = /Footprint: ([\d.]+) (KB|MB|GB)/.exec(out);
  if (!m) return null;
  return Number(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]];
}

/** Cumulative CPU seconds of a process. */
export function cpuSec(pid) {
  const t = execFileSync("ps", ["-o", "time=", "-p", String(pid)], { encoding: "utf8" }).trim();
  return t.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
}

/** Front-to-back windows intersecting a rect. */
export function zorder(rect) {
  return JSON.parse(execFileSync(ZORDER, [rect.x, rect.y, rect.w, rect.h].map(String), { encoding: "utf8" }));
}

/** Starts the cover window; resolves with its process and the epoch ms it came up. */
export function cover(rect, seconds, activate) {
  const args = [rect.x, rect.y, rect.w, rect.h, seconds].map(String);
  if (activate) args.push("activate");
  const child = spawn(COVER, args);
  return new Promise((resolve) => {
    child.stdout.on("data", (d) => {
      const m = /cover_up (\d+)/.exec(String(d));
      if (m) resolve({ child, upAt: Number(m[1]) });
    });
  });
}

export const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))] : null;
};

/** In-window JS: open the settings window at a logical rect (from main, which may create windows). */
export const OPEN_SETTINGS = (x, y) => `(async () => {
  const { WebviewWindow } = window.__TAURI__.webviewWindow;
  const w = new WebviewWindow("settings", { url: "settings.html", title: "YUI Settings", x: ${x}, y: ${y},
    width: 760, height: 680, resizable: true, decorations: true, transparent: false });
  return await new Promise((r) => { w.once("tauri://created", () => r("created")); w.once("tauri://error", (e) => r("error " + JSON.stringify(e))); });
})()`;

/**
 * In-window JS (main): show and focus the settings window. macOS 14+ activation is cooperative, so an
 * app launched by the harness cannot come in front of the owner's front app; `float` lifts settings
 * above it so the window is unoccluded and its webview renders (an occluded one reports "hidden").
 */
export const FOCUS_SETTINGS = (float) => `(async () => {
  const w = await window.__TAURI__.webviewWindow.WebviewWindow.getByLabel("settings");
  await w.show(); await w.setFocus(); if (${float}) await w.setAlwaysOnTop(true); return "focused";
})()`;

/** In-window JS: a window's logical outer frame by label. */
export const FRAME = (label) => `(async () => {
  const w = await window.__TAURI__.webviewWindow.WebviewWindow.getByLabel(${JSON.stringify(label)});
  const [p, s, k] = await Promise.all([w.outerPosition(), w.outerSize(), w.scaleFactor()]);
  return { x: p.x / k, y: p.y / k, w: s.width / k, h: s.height / k, scale: k };
})()`;

/** In-window JS (main): move the pet window to a logical point. */
export const MOVE_PET = (x, y) =>
  `window.__TAURI__.window.getCurrentWindow().setPosition(new window.__TAURI__.dpi.LogicalPosition(${x}, ${y})).then(() => "moved")`;

export const ON_TOP = (on) => `window.__TAURI__.window.getCurrentWindow().setAlwaysOnTop(${on}).then(() => "on_top=${on}")`;
