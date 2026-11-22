/**
 * SPIKE #1971 (never merged): option C probe — one monitor-sized stage window.
 * Active only when localStorage "spike.stage" holds {mode: "base" | "stage", x, y}: the reference
 * 400x600 framing sits at logical (x, y) on screen either way. "base" moves the 400x600 window there;
 * "stage" sizes the window to its monitor and draws the framing at (x, y) inside it.
 * Exposes window.__spike for the WebDriver scenarios (a verify bundle has no dev handles).
 */
import { invoke } from "@tauri-apps/api/core";
import { currentMonitor, getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import type { Renderer } from "../../renderer";

const REF = { width: 400, height: 600 };

interface SpikeConfig {
  mode: "base" | "stage";
  x: number;
  y: number;
}

const pct = (xs: number[], p: number): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))] : null;
};
const stats = (xs: number[]) => ({
  n: xs.length,
  p50: pct(xs, 50),
  p95: pct(xs, 95),
  max: xs.length ? Math.max(...xs) : null,
});

export function startSpikeStage(deps: {
  renderer: Pick<Renderer, "setViewWindow" | "onTick" | "hitTest" | "playMotion">;
  root: HTMLElement;
}): void {
  let cfg: SpikeConfig | null = null;
  try {
    cfg = JSON.parse(localStorage.getItem("spike.stage") ?? "null");
  } catch {}
  if (!cfg) return;
  const { renderer, root } = deps;
  const win = getCurrentWindow();
  let place = { x: cfg.x, y: cfg.y };
  let mode = cfg.mode;

  const ticks: number[] = [];
  renderer.onTick(() => {
    ticks.push(performance.now());
    if (ticks.length > 6000) ticks.splice(0, 3000);
  });

  const keylog: Array<{ t: number; key: string; target: string; trusted: boolean }> = [];
  document.addEventListener(
    "keydown",
    (e) => {
      const t = e.target as HTMLElement | null;
      keylog.push({ t: Date.now(), key: e.key, target: t?.id || t?.tagName || "", trusted: e.isTrusted });
    },
    true,
  );
  const focuslog: Array<{ t: number; ev: string }> = [];
  window.addEventListener("focus", () => focuslog.push({ t: Date.now(), ev: "window.focus" }));
  window.addEventListener("blur", () => focuslog.push({ t: Date.now(), ev: "window.blur" }));
  void win.onFocusChanged(({ payload }) => focuslog.push({ t: Date.now(), ev: `tauri.focus=${payload}` }));

  // Fake OS cursor for the hit-test poll: answers the cursor_position IPC with a chosen logical point.
  let fake: { x: number; y: number } | null = null;
  let scale = 2;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (fake && /cursor_position/.test(u)) {
      const origin = await win.outerPosition();
      return new Response(JSON.stringify({ x: origin.x + fake.x * scale, y: origin.y + fake.y * scale }), {
        status: 200,
        headers: { "Tauri-Response": "ok", "content-type": "application/json" },
      });
    }
    return realFetch(input, init);
  };
  // While set, trusted pointermove events (the owner's real mouse) never reach the hit-test.
  let blockTrusted = false;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (blockTrusted && e.isTrusted) e.stopImmediatePropagation();
    },
    true,
  );
  const synthMove = (x: number, y: number): void => {
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, bubbles: true }));
  };

  async function monitorLogical() {
    const m = await currentMonitor();
    if (!m) throw new Error("no monitor");
    scale = m.scaleFactor;
    return {
      x: m.position.x / m.scaleFactor,
      y: m.position.y / m.scaleFactor,
      width: m.size.width / m.scaleFactor,
      height: m.size.height / m.scaleFactor,
      scale: m.scaleFactor,
    };
  }

  async function apply(): Promise<void> {
    await win.setAlwaysOnTop(true);
    const m = await monitorLogical();
    if (mode === "base") {
      renderer.setViewWindow(null);
      await invoke("set_frame_logical", { x: place.x, y: place.y, ...REF });
    } else {
      await invoke("set_frame_logical", { x: m.x, y: m.y, width: m.width, height: m.height });
      renderer.setViewWindow({ x: place.x - m.x, y: place.y - m.y, ...REF });
    }
    // The hit-test starts in CAPTURE; a monitor-sized window would take every click until the first move.
    // A hidden document (right after launch) sends it back to CAPTURE, so repeat once visible.
    for (const ms of [0, 1000, 3000]) setTimeout(() => [0, 1, 2].forEach(() => synthMove(-50, -50)), ms);
  }
  // Overlay surfaces anchor to the window, not to her; hidden in both modes so neither draws or captures them.
  document.head.append(
    Object.assign(document.createElement("style"), {
      textContent: ".yui-ui, .yui-status, .yui-sigchips, .yui-threadchip, .yui-deleg { display: none !important; }",
    }),
  );

  function el(tag: string, css: string, attrs: Record<string, string> = {}): HTMLElement {
    const e = document.createElement(tag);
    e.style.cssText = css;
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  let panel: HTMLElement | null = null;
  let pills: HTMLElement[] = [];
  function openPanel(rect = { x: 484, y: 238, width: 760, height: 640 }): DOMRect {
    closePanel();
    panel = el(
      "div",
      `position:fixed;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;z-index:9000;` +
        "display:flex;pointer-events:auto;font:14px system-ui;border-radius:14px;overflow:hidden;" +
        "box-shadow:0 12px 40px rgba(0,0,0,.35)",
      { class: "spike-hit", id: "spike-panel" },
    );
    const stageArea = el(
      "div",
      "width:300px;height:100%;border:2px dashed rgba(255,255,255,.6);box-sizing:border-box;background:rgba(20,20,30,.15)",
      { id: "spike-stage-area" },
    );
    const form = el("form", "flex:1;background:#f4f1ec;color:#222;padding:24px;display:flex;flex-direction:column;gap:14px", {
      id: "spike-form",
    });
    form.addEventListener("submit", (e) => e.preventDefault());
    form.append(el("h2", "margin:0 0 8px", {}));
    (form.firstChild as HTMLElement).textContent = "Settings (spike panel)";
    for (let i = 1; i <= 3; i++) {
      form.append(el("input", "font:inherit;padding:8px;border:1px solid #999;border-radius:6px", { id: `spike-in-${i}`, type: "text" }));
    }
    const btn = el("button", "font:inherit;padding:8px 14px;align-self:flex-start", { id: "spike-close", type: "button" });
    btn.textContent = "Close";
    form.append(btn);
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
    panel.append(stageArea, form);
    root.append(panel);
    pills = [0, 1, 2].map((i) => {
      const p = el(
        "button",
        `position:fixed;left:${place.x + 20 + i * 125}px;top:${place.y - 40}px;width:110px;height:30px;z-index:9001;` +
          "pointer-events:auto;border-radius:15px;border:0;background:#2b2b38;color:#fff;font:13px system-ui",
        { class: "spike-hit", id: `spike-pill-${i}` },
      );
      p.textContent = ["Talk", "Threads", "Settings"][i];
      root.append(p);
      return p;
    });
    return panel.getBoundingClientRect();
  }
  function closePanel(): void {
    panel?.remove();
    panel = null;
    for (const p of pills) p.remove();
    pills = [];
  }

  /** Moves the reference framing from `from` to `to` over `ms`, by render offset or by OS window move. */
  async function move(from: { x: number; y: number }, to: { x: number; y: number }, ms: number, motion?: string) {
    if (motion) renderer.playMotion({ id: motion });
    const t0 = performance.now();
    const raf: number[] = [];
    const call: number[] = [];
    const m = await monitorLogical();
    await new Promise<void>((resolve) => {
      const step = async () => {
        const now = performance.now();
        raf.push(now);
        const k = Math.min(1, (now - t0) / ms);
        const x = from.x + (to.x - from.x) * k;
        const y = from.y + (to.y - from.y) * k;
        const c0 = performance.now();
        if (mode === "stage") renderer.setViewWindow({ x: x - m.x, y: y - m.y, ...REF });
        else await win.setPosition(new LogicalPosition(x, y));
        call.push(performance.now() - c0);
        if (k < 1) requestAnimationFrame(() => void step());
        else resolve();
      };
      requestAnimationFrame(() => void step());
    });
    place = to;
    if (motion) renderer.playMotion(null);
    const t1 = performance.now();
    const rendered = ticks.filter((t) => t >= t0 && t <= t1);
    const iv = (xs: number[]) => xs.slice(1).map((t, i) => t - xs[i]);
    return {
      mode,
      ms: Math.round(t1 - t0),
      rendered_frames: rendered.length,
      rendered_interval_ms: stats(iv(rendered)),
      raf_interval_ms: stats(iv(raf)),
      move_call_ms: stats(call),
    };
  }

  const api = {
    config: () => ({ mode, place }),
    apply: async (next?: Partial<SpikeConfig>) => {
      if (next?.mode) mode = next.mode;
      if (next?.x != null && next?.y != null) place = { x: next.x, y: next.y };
      await apply();
      return api.frame();
    },
    frame: async () => {
      const [p, s, k] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor()]);
      return {
        x: p.x / k,
        y: p.y / k,
        w: s.width / k,
        h: s.height / k,
        scale: k,
        dpr: window.devicePixelRatio,
        inner: [innerWidth, innerHeight],
        canvas: (() => {
          const c = document.querySelector("canvas");
          return c ? [c.width, c.height] : null;
        })(),
        monitor: await monitorLogical(),
      };
    },
    /** Rendered frames over the last `ms`. */
    frames: (ms: number) => {
      const now = performance.now();
      const last = ticks.filter((t) => t > now - ms);
      return { frames: last.length, interval_ms: stats(last.slice(1).map((t, i) => t - last[i])) };
    },
    /** A body pixel of hers: the first point on a 10 px grid of the framing where the alpha hit-test hits. */
    bodyPoint: () => {
      const ox = mode === "stage" ? place.x : 0;
      const oy = mode === "stage" ? place.y : 0;
      const hits: Array<{ x: number; y: number }> = [];
      for (let y = 0; y < REF.height; y += 10)
        for (let x = 0; x < REF.width; x += 10) if (renderer.hitTest(ox + x, oy + y)) hits.push({ x: ox + x, y: oy + y });
      if (!hits.length) return null;
      const mid = hits[Math.floor(hits.length / 2)];
      return { mid, count: hits.length, minY: Math.min(...hits.map((h) => h.y)), maxY: Math.max(...hits.map((h) => h.y)) };
    },
    openPanel: (rect?: { x: number; y: number; width: number; height: number }) => {
      const r = openPanel(rect);
      return { panel: r.toJSON(), pills: pills.map((p) => p.getBoundingClientRect().toJSON()) };
    },
    closePanel,
    panelOpen: () => panel !== null,
    fakeCursor: (x: number | null, y?: number) => {
      fake = x === null ? null : { x, y: y ?? 0 };
      return Date.now();
    },
    blockTrusted: (on: boolean) => {
      blockTrusted = on;
    },
    synthMove: (x: number, y: number, n = 3) => {
      for (let i = 0; i < n; i++) synthMove(x, y);
      return Date.now();
    },
    move,
    keylog: () => keylog,
    focuslog: () => focuslog,
    native: (action: string) => invoke("spike_native", { action }),
    setFocusable: (on: boolean) => win.setFocusable(on),
    setFocus: () => win.setFocus(),
    setOnTop: (on: boolean) => win.setAlwaysOnTop(on),
    focusInput: (id = "spike-in-1") => {
      const i = document.getElementById(id) as HTMLInputElement | null;
      i?.focus();
      return { active: document.activeElement?.id ?? null, hasFocus: document.hasFocus() };
    },
    inputs: () =>
      [1, 2, 3].map((i) => (document.getElementById(`spike-in-${i}`) as HTMLInputElement | null)?.value ?? null),
    active: () => ({ active: document.activeElement?.id ?? null, hasFocus: document.hasFocus(), visibility: document.visibilityState }),
  };
  (window as unknown as { __spike: typeof api }).__spike = api;
  void apply();
}
