// SPIKE #2035 option A: dock the pet window over the settings stage rect, then measure z-order against a
// covering window of another process, the follow lag while settings moves, and focus-driven mitigations.
import { execFileSync, spawn } from "node:child_process";
import { cover, FOCUS_SETTINGS, FRAME, MOVE_PET, ON_TOP, OPEN_SETTINGS, pct, zorder } from "./lib.mjs";

const SAMPLER = `${process.env.SPIKE_SCRATCH}/follow-sampler`;
const front = () => execFileSync("bash", ["-c", 'lsappinfo info -only name "$(lsappinfo front)"'], { encoding: "utf8" }).trim();

/** Order of pet / settings / cover among the windows over the settings rect, front first. */
function order(rect) {
  const rows = zorder(rect);
  const name = (r) =>
    r.owner === "spike-cover" ? "cover" : r.owner !== "YUI Verify" ? "other" : r.w === 400 && r.h === 600 ? "pet" : r.w === 760 ? "settings" : `yui(${r.w}x${r.h})`;
  return rows.map((r) => `${name(r)}@L${r.layer}`).filter((s) => !s.startsWith("other")).join(" > ");
}

async function covered(h, rect, activate) {
  const c = await cover({ x: rect.x + 100, y: rect.y + 60, w: 500, h: 500 }, 3, activate);
  await h.sleep(1200);
  const o = order(rect);
  const f = front();
  await new Promise((r) => c.child.once("exit", r));
  return { order: o, front_app: f, coverUpAt: c.upAt };
}

const MOVE_SETTINGS = (x0, y0, dir) => `(async () => {
  const s = await window.__TAURI__.webviewWindow.WebviewWindow.getByLabel("settings");
  const { LogicalPosition } = window.__TAURI__.dpi;
  for (let i = 1; i <= 60; i++) {
    await s.setPosition(new LogicalPosition(${x0} + ${dir} * i * 5, ${y0}));
    await new Promise((r) => setTimeout(r, 16));
  }
  return "moved";
})()`;

/** Moves settings 300 px right and back while sampling both frames; lag = leader step → follower at offset. */
async function followLag(h, ids, s, dx) {
  const child = spawn(SAMPLER, [String(ids.settings), String(ids.pet), "6"]);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  await h.sleep(300);
  await h.exec(MOVE_SETTINGS(s.x, s.y, 1));
  await h.exec(MOVE_SETTINGS(s.x + 300, s.y, -1));
  await new Promise((r) => child.once("exit", r));
  const { polls, rows } = JSON.parse(out);
  const lags = [];
  let misses = 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === rows[i - 1][1]) continue;
    const want = rows[i][1] + dx;
    const hit = rows.slice(i).find((r) => Math.abs(r[2] - want) < 1);
    if (hit) lags.push(hit[0] - rows[i][0]);
    else misses++;
  }
  return { leader_steps: lags.length + misses, misses, lag_p50_ms: pct(lags, 50), lag_p95_ms: pct(lags, 95), lag_max_ms: Math.max(...lags), changes: rows.length, poll_ms: Math.round((6000 / polls) * 10) / 10 };
}

export default async function (h, steps) {
  steps.front_before = front();
  await h.exec(ON_TOP(true));
  steps.open = await h.exec(OPEN_SETTINGS(500, 100));
  await h.sleep(2500);
  steps.focus = await h.exec(FOCUS_SETTINGS(false));
  h.activate();
  await h.sleep(1000);
  steps.front_after_activate = front();
  const s = await h.exec(FRAME("settings"));
  steps.settings_frame = s;
  const pet = { x: s.x - 50, y: s.y + 68 };
  await h.exec(MOVE_PET(pet.x, pet.y));
  await h.sleep(500);
  const rect = { x: s.x, y: s.y, w: s.w, h: s.h };
  const rows = zorder(rect).filter((r) => r.owner === "YUI Verify");
  const ids = { pet: rows.find((r) => r.w === 400)?.id, settings: rows.find((r) => r.w === 760)?.id };
  steps.ids = ids;
  steps.docked = order(rect);

  // c0: production level (floating), no native link.
  steps.c0_floating_unlinked = await covered(h, rect, false);
  // c1: native child link (window_dock_attach keeps the floating level).
  steps.c1_attach = await h.exec(`window.__TAURI__.core.invoke("window_dock_attach", { parentLabel: "settings" })`);
  steps.c1_floating_linked = await covered(h, rect, false);
  steps.f1_follow_linked = await followLag(h, ids, s, pet.x - s.x);
  // c2: linked, normal level.
  await h.exec(ON_TOP(false));
  await h.sleep(300);
  steps.c2_normal_linked_alone = order(rect);
  steps.c2_normal_linked_covered = await covered(h, rect, false);
  steps.c2_normal_linked_cover_activates = await covered(h, rect, true);
  await h.exec(FOCUS_SETTINGS(false));
  await h.sleep(500);
  steps.c2_after_refocus = order(rect);
  // The pet window itself taking focus (what a click on her does) while linked at normal level.
  await h.exec("window.__TAURI__.window.getCurrentWindow().setFocus().then(() => 'pet_focused')");
  await h.sleep(500);
  steps.c2_pet_focused = order(rect);
  // c3: unlinked, normal level, settings focused again.
  await h.exec(`window.__TAURI__.core.invoke("window_dock_detach")`);
  await h.exec(FOCUS_SETTINGS(false));
  await h.sleep(500);
  steps.c3_normal_unlinked_settings_focused = order(rect);

  // f2: no native link, the webview follows settings' moved events (the off-macOS path).
  await h.exec(ON_TOP(true));
  await h.exec(MOVE_PET(pet.x, pet.y));
  steps.f2_wire = await h.exec(`(async () => {
    const s = await window.__TAURI__.webviewWindow.WebviewWindow.getByLabel("settings");
    const me = window.__TAURI__.window.getCurrentWindow();
    const { LogicalPosition } = window.__TAURI__.dpi;
    const k = await s.scaleFactor();
    window.__spikeUnfollow = await s.onMoved(({ payload }) => {
      void me.setPosition(new LogicalPosition(payload.x / k - 50, payload.y / k + 68));
    });
    return "following";
  })()`);
  steps.f2_follow_js = await followLag(h, ids, s, pet.x - s.x);
  await h.exec("(window.__spikeUnfollow(), 'unfollowed')");

  // c4: hide on blur, show on focus (the mitigation for the floating pet).
  steps.c4_wire = await h.exec(`(async () => {
    const s = await window.__TAURI__.webviewWindow.WebviewWindow.getByLabel("settings");
    const me = window.__TAURI__.window.getCurrentWindow();
    window.__spikeFocus = [];
    await s.onFocusChanged(({ payload }) => {
      window.__spikeFocus.push({ focused: payload, t: Date.now() });
      // Hide only. A first run also showed her on focus: show() makes the pet key, which blurs settings, which
      // hides her, and the pair looped (8 hide/show flips in 40 ms, then again after the next focus).
      if (!payload) me.hide().then(() => window.__spikeFocus.push({ applied: "hide", t: Date.now() }));
    });
    return "wired";
  })()`);
  await h.exec(FOCUS_SETTINGS(false));
  await h.sleep(500);
  steps.c4_front_before = front();
  steps.c4_cover_activates = await covered(h, rect, true);
  steps.c4_focus_events = await h.exec("window.__spikeFocus");
  // In-app blur: the pet window taking focus (a click on her) also blurs settings, so hide-on-blur hides her.
  await h.exec(FOCUS_SETTINGS(false));
  await h.exec("window.__TAURI__.window.getCurrentWindow().show().then(() => 'pet_shown')");
  await h.sleep(500);
  const n = (await h.exec("window.__spikeFocus")).length;
  await h.exec("window.__TAURI__.window.getCurrentWindow().setFocus().then(() => 'pet_focused')");
  await h.sleep(800);
  steps.c4_after_pet_focus = { order: order(rect), events: (await h.exec("window.__spikeFocus")).slice(n) };
}
