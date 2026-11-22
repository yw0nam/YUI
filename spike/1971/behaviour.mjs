// SPIKE #1971 (never merged): option C behaviour on one launch in stage mode.
//   A menu bar / Dock layering, B click-through by region (no mouse events: windowNumberAtPoint answers which
//   window a mouse-down would hit; the hit-test is fed a fake cursor and the owner's real pointermoves are blocked),
//   C keyboard focus (CGEventPostToPid into YUI only), D the panel against another app, E movement by render offset
//   and, for comparison, by OS window move.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { appPid, pct, S, startProbe } from "./lib.mjs";

const REF = { w: 400, h: 600 };
const SPOT = { x: 1268, y: 477 };
const PANEL = { x: 484, y: 238, width: 760, height: 640 };
const COVER = { x: 300, y: 150, w: 1400, h: 950 };

export default async function (h, steps) {
  const probe = startProbe();
  await probe.ready;
  const P = (c) => probe.send(c);
  const X = (e) => h.exec(S(e));
  const yui = appPid();
  const stageWin = async () =>
    (await P(`zorder 0 0 1728 1117`)).windows.find((w) => w.owner === "YUI Verify" && w.w >= 1700);
  const shot = (name, id) => {
    const file = path.join(h.OUT, name);
    execFileSync("screencapture", ["-x", "-o", "-l", String(id), file]);
    return file;
  };
  const front0 = await P("front");
  steps.front_at_start = front0;
  try {
    // ── A: geometry and layering ───────────────────────────────────────────────
    await h.sleep(1500);
    steps.A_screens = await P("screens");
    steps.A_frame = await X("s.frame()");
    steps.A_native = await X('s.native("state")');
    steps.A_app = await P(`app ${yui}`);
    const sw = await stageWin();
    steps.A_stage_window = sw;
    await X("s.apply({ x: 40, y: -90 })");
    await X("s.synthMove(5, 900, 3)");
    await h.sleep(800);
    steps.A_menubar_band = (await P("zorder 0 0 1728 33")).windows.slice(0, 8);
    steps.A_dock_band = (await P("zorder 0 1080 1728 37")).windows.slice(0, 8);
    steps.A_shot_menubar = shot("A-stage-under-menubar.png", sw.id);
    await X(`s.apply({ x: ${SPOT.x}, y: ${SPOT.y} })`);
    await h.sleep(500);

    // ── B: click-through by region ─────────────────────────────────────────────
    const panel = await X("s.openPanel()");
    steps.B_panel = panel;
    const body = await X("s.bodyPoint()");
    steps.B_body = body;
    const cover = await P(`cover ${COVER.x} ${COVER.y} ${COVER.w} ${COVER.h}`);
    steps.B_cover = cover;
    await h.sleep(400);
    await X("s.blockTrusted(true)");
    const T = [
      [350, 200], [900, 180], [1650, 200], [400, 1050], [1000, 1060], [1650, 1060],
      [SPOT.x + 5, SPOT.y + 5], [SPOT.x + 395, SPOT.y + 590], [PANEL.x - 14, 600], [PANEL.x + PANEL.width + 12, 600],
    ];
    await X(`s.fakeCursor(${T[0][0]}, ${T[0][1]})`);
    await X(`s.synthMove(${T[0][0]}, ${T[0][1]}, 3)`);
    await h.sleep(300);
    steps.B_native_passthrough = await X('s.native("state")');
    const transparent = [];
    for (const [x, y] of T) {
      await X(`s.fakeCursor(${x}, ${y})`);
      await h.sleep(200);
      const r = await P(`hit ${x} ${y}`);
      transparent.push({ x, y, window: r.window, owner: r.owner, to_stage: r.window === sw.id, to_cover: r.window === cover.window });
    }
    steps.B_transparent = transparent;
    steps.B_transparent_pass = `${transparent.filter((t) => !t.to_stage).length}/${transparent.length} passed the stage (${transparent.filter((t) => t.to_cover).length} landed on the cover, the rest on an owner window above it)`;

    const inp = panel.panel;
    const I = {
      input: [Math.round(inp.x + 300 + 230), Math.round(inp.y + 90)],
      stage_area: [inp.x + 150, inp.y + 320],
      form_blank: [inp.x + 600, inp.y + 560],
      panel_edge: [inp.x + 2, inp.y + 2],
      pill_0: [Math.round(panel.pills[0].x + 55), Math.round(panel.pills[0].y + 15)],
      pill_1: [Math.round(panel.pills[1].x + 55), Math.round(panel.pills[1].y + 15)],
      pill_2: [Math.round(panel.pills[2].x + 55), Math.round(panel.pills[2].y + 15)],
      body: body ? [body.mid.x, body.mid.y] : null,
    };
    const leave = [1000, 1060];
    const enterLeave = async (name, [x, y]) => {
      const w = P(`watch ${x} ${y} 500`);
      await h.sleep(20);
      const tSet = await X(`s.fakeCursor(${x}, ${y})`);
      const wr = await w;
      const toStage = wr.changes.find((c) => c.window === sw.id);
      const settled = await P(`hit ${x} ${y}`);
      // Leaving: in CAPTURE the hit-test listens to pointermove; real moves arrive at mouse rate.
      const w2 = P(`watch ${x} ${y} 400`);
      await h.sleep(20);
      const tLeave = await X(`(async () => { s.fakeCursor(${leave[0]}, ${leave[1]}); s.synthMove(${leave[0]}, ${leave[1]}, 1); await new Promise(r => setTimeout(r, 8)); s.synthMove(${leave[0]}, ${leave[1]}, 1); return Date.now(); })()`);
      const wr2 = await w2;
      const toCover = wr2.changes.find((c) => c.window !== sw.id && c.at >= tLeave - 10);
      return {
        name, x, y,
        takes_click: settled.window === sw.id,
        enter_latency_ms: toStage ? toStage.at - tSet : null,
        leave_latency_ms: toCover ? toCover.at - tLeave : null,
      };
    };
    const interactive = [];
    for (const [name, pt] of Object.entries(I)) if (pt) interactive.push(await enterLeave(name, pt));
    steps.B_interactive = interactive;
    const reps = [];
    for (let i = 0; i < 10; i++) reps.push(await enterLeave(`input#${i}`, I.input));
    steps.B_input_reps = reps;
    const en = [...interactive, ...reps].map((r) => r.enter_latency_ms).filter((v) => v != null);
    const lv = [...interactive, ...reps].map((r) => r.leave_latency_ms).filter((v) => v != null);
    steps.B_summary = {
      interactive_take_clicks: `${[...interactive, ...reps].filter((r) => r.takes_click).length}/${interactive.length + reps.length}`,
      enter_ms: { n: en.length, p50: pct(en, 50), p95: pct(en, 95), max: Math.max(...en) },
      leave_ms: { n: lv.length, p50: pct(lv, 50), p95: pct(lv, 95), max: Math.max(...lv) },
    };
    await P("uncover");
    await X("s.fakeCursor(null)");
    await X("s.blockTrusted(false)");

    // ── C: keyboard focus ──────────────────────────────────────────────────────
    steps.C0_front = await P("front");
    steps.C0_native = await X('s.native("state")');
    await X("s.setFocusable(false)");
    steps.C1_unfocusable_native = await X('s.native("state")');
    await X("s.setFocusable(true)");
    await X("s.setFocus()");
    await h.sleep(500);
    steps.C2_after_setFocus = { front: await P("front"), native: await X('s.native("state")'), page: await X("s.active()") };
    steps.C3_focus_input = await X('s.focusInput("spike-in-1")');
    steps.C3_keys1 = await P(`keys ${yui} abc`);
    await h.sleep(300);
    steps.C3_after_abc = { inputs: await X("s.inputs()"), page: await X("s.active()") };
    await P(`keys ${yui} \\t`);
    await h.sleep(200);
    steps.C3_after_tab = await X("s.active()");
    await P(`keys ${yui} xy`);
    await h.sleep(200);
    steps.C3_after_xy = await X("s.inputs()");
    await P(`keys ${yui} \\e`);
    await h.sleep(300);
    steps.C3_after_escape = { panel_open: await X("s.panelOpen()"), keylog: (await X("s.keylog()")).slice(-8) };
    await X("s.setFocusable(false)");
    await h.sleep(500);
    steps.C4_closed_unfocusable = { front: await P("front"), native: await X('s.native("state")') };
    steps.C5_deactivate = await X('s.native("deactivate")');
    await h.sleep(500);
    steps.C5_after_deactivate = { front: await P("front"), native: await X('s.native("state")') };
    // Option: hide the app (the system activates the next app), then unhide without activating.
    steps.C6_hide_app = await X('s.native("hide_app")');
    await h.sleep(400);
    steps.C6_after_hide = { front: await P("front"), stage_on_screen: !!(await stageWin()) };
    steps.C6_unhide_quiet = await X('s.native("unhide_quiet")');
    await h.sleep(400);
    steps.C6_after_unhide = { front: await P("front"), stage_on_screen: !!(await stageWin()), native: await X('s.native("state")') };
    await X("s.setFocusable(true)");

    // ── D: the open panel against another app ─────────────────────────────────
    const panelRect = `${PANEL.x} ${PANEL.y} ${PANEL.width} ${PANEL.height}`;
    const zAt = async () =>
      (await P(`zorder ${panelRect}`)).windows
        .filter((w) => w.owner === "YUI Verify" || w.owner === "probe")
        .map((w) => `${w.owner === "probe" ? "cover" : w.w >= 1700 ? "stage" : "yui-other"}@${w.layer}`);
    await X("s.openPanel()");
    await X("s.setFocus()");
    await h.sleep(400);
    const cov2 = await P("cover 400 200 900 700");
    await h.sleep(300);
    const mark = Date.now();
    steps.D1_activate_other = await P("activate");
    const fronts = [];
    for (let i = 0; i < 12; i++) {
      const f = await P("front");
      fronts.push(`${f.at - mark}ms:${f.name}`);
      await h.sleep(50);
    }
    steps.D1_front_series = fronts;
    steps.D1_floating = {
      front: await P("front"),
      zorder: await zAt(),
      native: await X('s.native("state")'),
      blur: (await X("s.focuslog()")).filter((f) => f.t >= mark).map((f) => ({ ...f, after_ms: f.t - mark })),
    };
    steps.D1_shot = shot("D1-panel-over-other-app.png", sw.id);
    // Option: drop always-on-top (normal level) while the panel is open.
    await X("s.setOnTop(false)");
    await h.sleep(300);
    steps.D2_normal_level_other_active = { zorder: await zAt(), native: await X('s.native("state")') };
    await P("activate");
    await h.sleep(400);
    steps.D2_normal_level_other_reactivated = { zorder: await zAt(), front: await P("front") };
    await X("s.setFocus()");
    await h.sleep(500);
    steps.D2_normal_level_yui_focused = { zorder: await zAt(), front: await P("front") };
    await P("activate");
    await h.sleep(500);
    steps.D2_normal_level_back_to_other = { zorder: await zAt(), front: await P("front") };
    await X("s.setOnTop(true)");
    await h.sleep(300);
    steps.D3_floating_again = { zorder: await zAt(), front: await P("front") };
    await P("uncover");
    steps.D_cover = cov2;

    // ── E: movement inside the stage, then by OS window move ─────────────────
    await X("s.setFocusable(false)");
    await X(`s.apply({ x: ${SPOT.x}, y: ${SPOT.y} })`);
    await X("s.openPanel()");
    await h.sleep(1500);
    const into = { x: PANEL.x + 150 - REF.w / 2, y: PANEL.y + PANEL.height - REF.h };
    const E = [];
    for (let i = 0; i < 3; i++) {
      E.push(await X(`s.move(${JSON.stringify(SPOT)}, ${JSON.stringify(into)}, 1500, "walk")`));
      await h.sleep(1200);
      if (i === 0) steps.E_shot_in_panel = shot("E-in-panel-stage-area.png", sw.id);
      E.push(await X(`s.move(${JSON.stringify(into)}, ${JSON.stringify(SPOT)}, 1500, "walk")`));
      await h.sleep(1200);
    }
    steps.E_stage_moves = E;
    await X("s.closePanel()");
    await X(`s.apply({ mode: "base", x: ${SPOT.x}, y: ${SPOT.y} })`);
    await h.sleep(1500);
    const B = [];
    for (let i = 0; i < 3; i++) {
      B.push(await X(`s.move(${JSON.stringify(SPOT)}, ${JSON.stringify(into)}, 1500, "walk")`));
      await h.sleep(1200);
      B.push(await X(`s.move(${JSON.stringify(into)}, ${JSON.stringify(SPOT)}, 1500, "walk")`));
      await h.sleep(1200);
    }
    steps.E_os_moves = B;
  } finally {
    steps.front_before_restore = await P("front");
    if (front0.pid) steps.restore = await P(`restore ${front0.pid}`);
    await h.sleep(300);
    steps.front_at_end = await P("front");
    probe.quit();
  }
}
