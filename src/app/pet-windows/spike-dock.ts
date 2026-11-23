/**
 * SPIKE #2045 (never merged): docks this pet window over its settings window on request from the probe panel
 * in settings (`spike-stage.ts`), and logs what the owner measures on Windows.
 *
 * Modes: `a` owner link (`window_dock_attach`, pet drops always-on-top), `b` follows settings' Moved events by the
 * same delta in logical points (pet keeps always-on-top), `ab` both, `off` releases. Logs at warn level so a
 * release build writes them to the app log.
 */

import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { createLogger } from "../../logger";
import { windowLabel } from "../../settings/preset/pet-windows";

const log = createLogger("spike-dock");

export type SpikeDockMode = "off" | "a" | "b" | "ab";

/** Pet frame relative to the settings frame while docked, in points (the #2035 dock offset). */
const OFFSET = { x: -50, y: 68 };
const FLUSH_IDLE_MS = 600;

const pct = (xs: number[], p: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
};

async function zorder(settingsLabel: string, why: string): Promise<void> {
  try {
    const order = await invoke("spike_dock_zorder", { parentLabel: settingsLabel });
    log.warn("spike_dock_zorder", { why, order });
  } catch (error) {
    log.warn("spike_dock_zorder_failed", { why, error: String(error) });
  }
}

/** Follows settings' Moved events; returns the unfollow. */
async function follow(
  settings: WebviewWindow,
  start: { settings: { x: number; y: number }; pet: { x: number; y: number } },
): Promise<() => void> {
  const me = getCurrentWindow();
  let settingsScale = await settings.scaleFactor();
  let petScale = await me.scaleFactor();
  let last = start.settings;
  let pet = start.pet;
  // Per drag: ms from settings' Moved reaching this webview to setPosition settling, and to this window's own Moved.
  let applied: number[] = [];
  let seen: number[] = [];
  let pending: { x: number; y: number; t0: number }[] = [];
  let events = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    log.warn("spike_dock_follow", {
      settings_moves: events,
      set_position_ms: { p50: pct(applied, 50), p95: pct(applied, 95), max: pct(applied, 100) },
      pet_moved_ms: { p50: pct(seen, 50), p95: pct(seen, 95), max: pct(seen, 100), n: seen.length },
      never_seen: pending.length,
    });
    applied = [];
    seen = [];
    pending = [];
    events = 0;
  };

  const unlisten: UnlistenFn[] = await Promise.all([
    settings.onScaleChanged(({ payload }) => {
      settingsScale = payload.scaleFactor;
    }),
    me.onScaleChanged(({ payload }) => {
      petScale = payload.scaleFactor;
    }),
    settings.onMoved(({ payload }) => {
      const t0 = performance.now();
      const now = { x: payload.x / settingsScale, y: payload.y / settingsScale };
      const dx = now.x - last.x;
      const dy = now.y - last.y;
      last = now;
      if (!dx && !dy) return;
      events++;
      pet = { x: pet.x + dx, y: pet.y + dy };
      pending.push({ ...pet, t0 });
      void me
        .setPosition(new LogicalPosition(pet.x, pet.y))
        .then(() => applied.push(performance.now() - t0));
      clearTimeout(timer);
      timer = setTimeout(flush, FLUSH_IDLE_MS);
    }),
    me.onMoved(({ payload }) => {
      const at = { x: payload.x / petScale, y: payload.y / petScale };
      const i = pending.findIndex((p) => Math.abs(p.x - at.x) < 1 && Math.abs(p.y - at.y) < 1);
      if (i < 0) return;
      seen.push(performance.now() - pending[i].t0);
      pending = pending.slice(i + 1);
    }),
  ]);
  return () => {
    clearTimeout(timer);
    if (events) flush();
    for (const u of unlisten) u();
  };
}

export async function wireSpikeDock(boundId: string | null): Promise<void> {
  const settingsLabel = boundId == null ? "settings" : windowLabel("settings", boundId);
  const me = getCurrentWindow();
  let owned = false;
  let unfollow: (() => void) | null = null;
  let watching: UnlistenFn[] = [];
  let chain = Promise.resolve();

  const status = (text: string) => void emit("spike://dock-status", { settingsLabel, text });

  /** Settings blur and minimise: where she sits then is what the owner checks. */
  async function watch(settings: WebviewWindow): Promise<void> {
    if (watching.length) return;
    watching = await Promise.all([
      settings.onFocusChanged(({ payload: focused }) => {
        if (!focused) setTimeout(() => void zorder(settingsLabel, "settings_blur_500ms"), 500);
      }),
      settings.onResized(() => {
        void settings.isMinimized().then((min) => {
          if (min) setTimeout(() => void zorder(settingsLabel, "settings_minimized_300ms"), 300);
        });
      }),
    ]);
  }

  async function apply(mode: SpikeDockMode): Promise<void> {
    log.warn("spike_dock_mode", { mode, settingsLabel, label: me.label });
    unfollow?.();
    unfollow = null;
    if (owned) {
      const t = performance.now();
      try {
        const r = await invoke<boolean>("window_dock_detach");
        log.warn("spike_dock_detach", {
          ok: true,
          returned: r,
          ms: Math.round(performance.now() - t),
        });
      } catch (error) {
        log.warn("spike_dock_detach", { ok: false, error: String(error) });
      }
      owned = false;
    }
    await me.setAlwaysOnTop(true);
    for (const u of watching) u();
    watching = [];
    if (mode === "off") {
      await zorder(settingsLabel, "after_off");
      status("off");
      return;
    }

    const settings = await WebviewWindow.getByLabel(settingsLabel);
    if (!settings) {
      log.warn("spike_dock_no_settings", { settingsLabel });
      status(`no window ${settingsLabel}`);
      return;
    }
    const k = await settings.scaleFactor();
    const pos = await settings.outerPosition();
    const s = { x: pos.x / k, y: pos.y / k };
    const pet = { x: s.x + OFFSET.x, y: s.y + OFFSET.y };
    await me.setPosition(new LogicalPosition(pet.x, pet.y));

    let text = `mode ${mode}`;
    if (mode === "a" || mode === "ab") {
      await me.setAlwaysOnTop(false);
      const t = performance.now();
      try {
        const r = await invoke<boolean>("window_dock_attach", { parentLabel: settingsLabel });
        owned = true;
        log.warn("spike_dock_attach", {
          ok: true,
          returned: r,
          ms: Math.round(performance.now() - t),
        });
        text += " · attach ok";
      } catch (error) {
        log.warn("spike_dock_attach", { ok: false, error: String(error) });
        text += ` · attach failed: ${String(error)}`;
      }
    }
    if (mode === "b" || mode === "ab") {
      unfollow = await follow(settings, { settings: s, pet });
      text += " · following";
    }
    await watch(settings);
    await zorder(settingsLabel, "after_dock");
    status(text);
  }

  await listen<{ settingsLabel: string; mode: SpikeDockMode }>("spike://dock", ({ payload }) => {
    if (payload.settingsLabel !== settingsLabel) return;
    chain = chain
      .then(() => apply(payload.mode))
      .catch((error) => log.warn("spike_dock_failed", { error: String(error) }));
  });
}
