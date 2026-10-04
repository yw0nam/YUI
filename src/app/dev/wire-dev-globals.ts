import type { Tier1Engine } from "../../ambient/liveliness/tier1";
import type { WindowRect } from "../../contract";
import type { EventBus } from "../../dispatcher/core/event-bus";
import type { Dispatcher } from "../../dispatcher/dispatcher";
import type { UserInputSource } from "../../dispatcher/sources/user-input-source";
import type { Renderer } from "../../renderer";
import { isTauri } from "../../tauri-env";
import type { VoiceInputStatus } from "../../ui/chips/voice-input-status";
import type { Surfaces } from "../../ui/surfaces/surfaces";

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
          });
        }),
      exit: () =>
        bus.push({
          source: "user_input_source",
          event_name: "user.window_sit_exit",
          ts: Date.now(),
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
      idleReturn: () => ambient.trigger("idle_returned"),
    },
  });
}
