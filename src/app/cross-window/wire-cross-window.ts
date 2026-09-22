import type { Tier1Engine } from "../../ambient/liveliness/tier1";
import type { WindowRect } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { UserInputSource } from "../../dispatcher/sources/user-input-source";
import type { SettingsBridge } from "../../io/bridge/settings-bridge";
import type { Logger } from "../../logger";
import type { Renderer } from "../../renderer";
import type { SettingsStores } from "../../settings/settings-stores";
import { isTauri } from "../../tauri-env";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { wireWindowSync } from "./wire-window-sync";

/**
 * Pet-window cross-window sync: the shared core plus the channels only this window owns — mouth
 * preview and the voice toggle/state pair, which ride the same bridge. `broadcastSettings` goes to
 * the VRM/speaker selections and `onRemoteChange` to `wireSettingsReload`, both wired by the caller
 * once those selections exist.
 */
export function wireCrossWindowSync(deps: {
  renderer: Pick<Renderer, "setMouthOpen" | "stopMouth">;
  voiceInputStatus: VoiceInputStatus;
  stores: SettingsStores;
  log: Logger;
}): {
  broadcastSettings: () => void;
  onRemoteChange: (cb: () => void) => void;
  /** The window's bus, for the channels this helper does not own itself. */
  bridge: SettingsBridge;
  dispose: () => void;
} {
  const { renderer, voiceInputStatus, stores, log } = deps;
  const core = wireWindowSync({ stores, windowKind: "pet", log });
  // Mouth preview (separate window → this window VRM): gain slider drag moves actual mouth.
  core.bridge.onMouthPreview((mouthOpen) => {
    if (mouthOpen == null) renderer.stopMouth();
    else renderer.setMouthOpen(mouthOpen);
  });
  // Voice toggle (separate window → this window STT): existing voiceInputStatus subscription starts/stops sttVad.
  core.bridge.onVoiceSet((on) => {
    log.info("voice_toggle_received", { on, source: "settings_window" });
    voiceInputStatus.set(on ? "listening" : "idle");
  });
  // Voice state (this window → separate window): separate window indicator reflects actual STT state.
  voiceInputStatus.subscribe((snapshot) => {
    core.bridge.emitVoiceState({ state: snapshot.state });
  });
  return {
    broadcastSettings: core.broadcastSettings,
    onRemoteChange: core.onRemoteChange,
    bridge: core.bridge,
    dispose: core.dispose,
  };
}

/**
 * Settings-window cross-window sync. Unlike the pet window, the VRM and speaker selections resync
 * here too — this window commits them store-only, so it has to pick up the pet window's picks.
 */
export function wireSettingsWindowSync(deps: {
  stores: SettingsStores;
  vrmSelection: { reloadFromStorage(): void };
  speakerSelection: { reloadFromStorage(): void };
  log: Logger;
}): {
  bridge: SettingsBridge;
  broadcastSettings: () => void;
  reload: () => void;
  dispose: () => void;
} {
  const { stores, vrmSelection, speakerSelection, log } = deps;
  const { bridge, broadcastSettings, reload, dispose } = wireWindowSync({
    stores,
    windowKind: "settings",
    extraResync: [vrmSelection, speakerSelection],
    log,
  });
  return { bridge, broadcastSettings, reload, dispose };
}

/** Devtools-window cross-window sync — the shared core with no window-specific extras. */
export function wireDevtoolsSync(deps: { stores: SettingsStores; log: Logger }): {
  reload: () => void;
  dispose: () => void;
} {
  const { reload, dispose } = wireWindowSync({
    stores: deps.stores,
    windowKind: "devtools",
    log: deps.log,
  });
  return { reload, dispose };
}

/**
 * DEV-only console/global handles for the screenshot validation loop and manual exploration:
 * `__yuiRenderer`/`__yuiSurfaces`/etc for direct inspection, `__yui_send`/`__yui_windowSit`/`__yuiDemo`
 * for firing dispatcher-spine events without a real gesture. Never runs in production builds.
 */
export async function wireDevGlobals(deps: {
  renderer: Renderer;
  ambient: Pick<Tier1Engine, "trigger">;
  surfaces: Surfaces;
  screenshotSettings: unknown;
  lipsyncSettings: unknown;
  agentSettings: unknown;
  quickControls: unknown;
  speechPlayback: unknown;
  voiceInputStatus: VoiceInputStatus;
  userInput: Pick<UserInputSource, "submit">;
  bus: EventBus;
  getDispatcher: () => Dispatcher | null;
  /** The sit-down the dev perch plays in place before it takes the seat. */
  sitDown: () => Promise<"done" | "lost">;
}): Promise<void> {
  const {
    renderer,
    ambient,
    surfaces,
    screenshotSettings,
    lipsyncSettings,
    agentSettings,
    quickControls,
    speechPlayback,
    voiceInputStatus,
    userInput,
    bus,
    getDispatcher,
    sitDown,
  } = deps;
  const { createMockDriver } = await import("../../ui/surfaces/mock");
  const mock: ReturnType<typeof createMockDriver> = createMockDriver(surfaces);
  Object.assign(globalThis as Record<string, unknown>, {
    __yuiSpeech: speechPlayback,
    __yuiRenderer: renderer,
    __yuiAmbient: ambient,
    __yuiSurfaces: surfaces,
    __yuiMock: mock,
    __yuiScreenshot: screenshotSettings,
    __yuiLipsync: lipsyncSettings,
    __yuiAgent: agentSettings,
    __yuiQuick: quickControls,
    __yuiVoiceInputStatus: voiceInputStatus,
    // DEV-ONLY trigger: fire E2E loop directly from console.
    //   window.__yui_send("hello") → user.text_submitted → dispatcher → backend_caller →
    //   streamChat → backend → ControlEnvelope → renderer.applyDirective + bubble.
    // Screenshot-validation handle: fires a real submit without a real gesture.
    __yui_send: (text: string) => userInput.submit(text),
    // Dispatcher observation: __yui_dispatcher.inFlight()/queue()/recentDrops().
    __yui_dispatcher: getDispatcher,
    // DEV-ONLY trigger: fire window_sit perch enter/exit/drop directly from console.
    //   window.__yui_windowSit.enter() → sit-down → user.window_sit_enter → dispatcher → renderer.
    //   window.__yui_windowSit.drop(rect) → user.window_sit_drop(geometry) → perch align.
    __yui_windowSit: {
      enter: () =>
        void sitDown().then((outcome) => {
          if (outcome !== "done") return;
          bus.push({
            source: "user_input_source",
            event_name: "user.window_sit_enter",
            ts: Date.now(),
            hint_tier: 1,
            dnd_override: true,
          });
        }),
      exit: () =>
        bus.push({
          source: "user_input_source",
          event_name: "user.window_sit_exit",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        }),
      // Compute edge_local_ypx from current window outerPosition/scaleFactor,
      // drive geometry path without real OS window (Tauri: actual values, else 0,0/1 fallback).
      drop: async (rect: WindowRect): Promise<void> => {
        let pos = { x: 0, y: 0 };
        let scale = 1;
        if (isTauri()) {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const w = getCurrentWindow();
            pos = await w.outerPosition();
            scale = await w.scaleFactor();
          } catch {
            /* fallback to 0,0 / 1 */
          }
        }
        const sf = scale > 0 ? scale : 1;
        bus.push({
          source: "os_event_watcher",
          event_name: "user.window_sit_drop",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
          payload: {
            edge_local_ypx: rect.y - pos.y / sf,
          },
        });
      },
      // Occupancy simulation: fire occlusion poll exit result (window_sit_exit) without real second window.
      occlude: (_rect?: WindowRect) =>
        bus.push({
          source: "os_event_watcher",
          event_name: "user.window_sit_exit",
          ts: Date.now(),
          hint_tier: 1,
          dnd_override: true,
        }),
    },
    // Step-by-step demo helpers
    __yuiDemo: {
      input: () => surfaces.summonInput(),
      tool: (id = "web_search") => surfaces.showTool(id),
      send: (text = "안녕") => userInput.submit(text),
      reply: (text = "오늘 일정 뭐 있어?") => mock.reply(text),
      proactive: () => mock.proactive(),
      speak: (line = "응, 듣고 있어. 그거 지금 같이 볼까?") => mock.speak(line),
      tap: () => ambient.trigger("tap_react"),
      idleReturn: () => ambient.trigger("idle_returned"),
    },
  });
}
