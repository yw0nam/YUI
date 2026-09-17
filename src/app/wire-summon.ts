import type { EventBus } from "../dispatcher/core/event-bus";
import { createSummonHotkey, type SummonHotkey } from "../io/window/summon-hotkey";
import { isTauri } from "../io/window/tauri-env";
import type { Logger } from "../logger";
import type { Surfaces } from "../ui/surfaces/surfaces";

export async function wirePeekExitTriggers(deps: {
  bus: EventBus;
  peek: { active(): boolean; exit(): Promise<void> };
  win: {
    onFocusChanged(handler: (event: { payload: boolean }) => void): Promise<() => void>;
    listen(event: "tray_toggle", handler: () => void): Promise<() => void>;
  };
}): Promise<() => void> {
  const exitPeek = async (): Promise<void> => {
    if (!deps.peek.active()) return;
    await deps.peek.exit();
    deps.bus.push({
      source: "os_event_watcher",
      event_name: "user.peek_exit",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
    });
  };
  const unlistenFocus = await deps.win.onFocusChanged((event) => {
    if (event.payload) void exitPeek();
  });
  let unlistenTray: (() => void) | undefined;
  try {
    unlistenTray = await deps.win.listen("tray_toggle", () => void exitPeek());
  } catch (error) {
    unlistenFocus();
    throw error;
  }
  return () => {
    unlistenFocus();
    unlistenTray?.();
  };
}

export async function showAndFocusFromSummon(deps: {
  bus: EventBus;
  peek: { active(): boolean; exit(): Promise<void> };
  win: { show(): Promise<void>; setFocus(): Promise<void> };
}): Promise<void> {
  await deps.win.show();
  if (deps.peek.active()) {
    await deps.peek.exit();
    deps.bus.push({
      source: "user_input_source",
      event_name: "user.peek_exit",
      ts: Date.now(),
      hint_tier: 1,
      dnd_override: true,
    });
  }
  await deps.win.setFocus();
}

/**
 * Global summon hotkey (Tauri-only — skipped in browser dev). Registers the configured
 * accelerator OS-globally; on fire, show+focus the window then summon input. Registration
 * failure fails soft (summon-hotkey warns, treats as inactive). The returned handle remains
 * stable while the asynchronous Tauri implementation initializes.
 */
export function wireSummonHotkey(deps: {
  surfaces: Pick<Surfaces, "summonInput" | "isInputOpen">;
  bus: EventBus;
  peek: { active(): boolean; exit(): Promise<void> };
  accelerator: string;
  /** The accelerator failed to register after every retry (OS/another app holds it). */
  onRegisterFailed?: (accelerator: string) => void;
  log: Logger;
}): SummonHotkey {
  const { surfaces, accelerator, log, bus, peek } = deps;
  let summonHotkey: SummonHotkey | null = null;
  let desiredAccelerator = accelerator;
  let disposed = false;
  const handle: SummonHotkey = {
    apply(next) {
      desiredAccelerator = next;
      return summonHotkey?.apply(next) ?? Promise.resolve();
    },
    current: () => summonHotkey?.current() ?? null,
    async dispose() {
      disposed = true;
      await summonHotkey?.dispose();
    },
  };
  if (!isTauri()) return handle;
  void (async () => {
    const { register, unregister, unregisterAll } = await import(
      "@tauri-apps/plugin-global-shortcut"
    );
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    summonHotkey = createSummonHotkey({
      register,
      unregister,
      unregisterAll,
      // On macOS, include background app activation, bring forward (show before hidden).
      focusWindow: async () => {
        await showAndFocusFromSummon({ win: getCurrentWindow(), peek, bus });
      },
      summonInput: () => surfaces.summonInput(),
      isInputOpen: () => surfaces.isInputOpen(),
      ...(deps.onRegisterFailed ? { onRegisterFailed: deps.onRegisterFailed } : {}),
    });
    if (disposed) return void summonHotkey.dispose();
    await summonHotkey.apply(desiredAccelerator);
  })().catch((err) => log.warn("summon_hotkey_wire_failed", { error: String(err) }));
  return handle;
}
