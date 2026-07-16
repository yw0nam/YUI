/** Bootstrap wiring helpers extracted from main.ts: VRM + speaker selection stores and their swap/import flows. */
import type { WindowRect } from "./contract";
import { createAgentSource } from "./dispatcher/agent-source";
import type { EventBus } from "./dispatcher/event-bus";
import { createProactiveSource, type ProactiveSource } from "./dispatcher/proactive-source";
import { createScheduleSource, type ScheduleSource } from "./dispatcher/schedule-source";
import { createSignalsSource, type SignalsSource } from "./dispatcher/signals-source";
import type { AgentNotifySettings } from "./io/agent-notify-settings";
import { resolveAssetUrl, resolveUserFileSrc } from "./io/asset-url";
import { selectFetch } from "./io/chat-client";
import { ensureRegistered, updateVoice } from "./io/irodori-voices";
import type { PresenceSettings } from "./io/presence-settings";
import type { ProactiveSettings } from "./io/proactive-settings";
import type { ScheduleSettings } from "./io/schedule-settings";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
import { createSummonHotkey, type SummonHotkey } from "./io/summon-hotkey";
import { isTauri } from "./io/tauri-env";
import {
  importVoiceFromFile,
  removeOrphanVoice,
  removeUserVoice as removeUserVoiceFile,
} from "./io/voice-import";
import { importVrmFromFile, removeOrphanVrm, removeUserVrm } from "./io/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "./io/vrm-selection";
import { createWindowDropSource } from "./io/window-drop-source";
import { createWindowResizeSource } from "./io/window-resize-source";
import type { Logger } from "./logger";
import type { Renderer, VrmLoadResult } from "./renderer";
import type { Surfaces } from "./ui/surfaces";

export function wireVrmSelection(deps: {
  renderer: Renderer;
  log: Logger;
  broadcastSettings: () => void;
}): {
  vrmSelection: ReturnType<typeof createVrmSelection>;
  loadVrmSerialized: (url: string) => Promise<VrmLoadResult>;
  swapVrm: (option: { id: string; url: string }) => Promise<void>;
  importVrm: () => Promise<void>;
} {
  const { renderer, log, broadcastSettings } = deps;
  // VRM selection store + swap. The pet window is renderer-backed: commit the store
  // only after loadVRM succeeds. Starts with a fallback default since config is not
  // loaded yet — the panel is needed early. After config loads, setManifest injects
  // the real available[] (see the boot sequence below).
  const vrmSelection = createVrmSelection({
    defaultUrl: "/vrms/carlotta.vrm",
    storage: localStorageVrmStorage(),
    userStorage: localStorageUserVrmStorage(),
  });
  // Single serial swap path: user swap, boot, config hot-reload, and cross-window all
  // pass through this chain. loadVRM is not re-entrant safe, so serialize it while
  // still propagating failures to the caller.
  let vrmSwap: Promise<unknown> = Promise.resolve();
  function loadVrmSerialized(url: string): Promise<VrmLoadResult> {
    // Resolve the logical path (/vrms/*.vrm) to a runtime URL — dev passthrough, Tauri bundled-resource absolute URL.
    const next = vrmSwap.then(async () => renderer.loadVRM(await resolveAssetUrl(url)));
    vrmSwap = next.catch(() => {}); // keep the chain alive even on failure,
    return next; // but propagate the reject only to this caller.
  }
  // Commit the store only on load success. On failure the await throws → store not committed (UI shows error + auto-recovers).
  const swapVrm = async (option: { id: string; url: string }): Promise<void> => {
    await loadVrmSerialized(option.url);
    vrmSelection.select(option.id);
  };
  // BYO-VRM import: pick file → copy → load → (label from meta name if present) → add option + select.
  // Cancel (null) is silently ignored. On load failure, delete the orphan file and throw without
  // adding the option (prior selection/renderer stay as-is — no recovery needed since the load
  // fails before currentVrm is replaced).
  const importVrm = async (): Promise<void> => {
    const option = await importVrmFromFile();
    if (option === null) return; // cancel
    let metaName: string | null;
    try {
      const src = await resolveUserFileSrc(option.url);
      ({ metaName } = await loadVrmSerialized(src));
    } catch (err) {
      // Remove the orphan copy — don't swallow a failure, surface it as a warning (the original error is still thrown).
      await removeOrphanVrm(option.id, removeUserVrm, (e) =>
        log.warn("orphan_vrm_cleanup_failed", { error: String(e) }),
      );
      log.error("imported_vrm_load_failed", { error: String(err) });
      throw err;
    }
    const labelled = metaName ? { ...option, label: metaName } : option;
    vrmSelection.addUserOption(labelled);
    vrmSelection.select(labelled.id);
  };
  // Announce cross-window so the VRM picked in this window reflects in the settings-window UI (loop guard lives in broadcastSettings).
  vrmSelection.subscribe(broadcastSettings);
  return { vrmSelection, loadVrmSerialized, swapVrm, importVrm };
}

export function wireSpeakerSelection(deps: {
  getEndpoints: () => { irodori_base_url?: string };
  log: Logger;
  broadcastSettings: () => void;
}): {
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  importVoice: () => Promise<void>;
} {
  const { getEndpoints, log, broadcastSettings } = deps;
  // irodori speaker selection store. Starts with an empty fallback since config is not
  // loaded yet — the panel is needed early. After config loads, setManifest injects the
  // real irodori_voices and default.
  const speakerSelection = createSpeakerSelection({
    defaultId: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  // Select → register in the irodori voice registry, then commit the store (mirrors swapVrm's load-then-select).
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    const f = await selectFetch();
    const eps = getEndpoints();
    if (eps.irodori_base_url) {
      await ensureRegistered({
        baseUrl: eps.irodori_base_url,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    }
    speakerSelection.select(option.id);
  };
  // Re-register the reference voice (PUT /voices) — server-side force-refresh only, does not change the speaker selection.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const f = await selectFetch();
    const eps = getEndpoints();
    if (!eps.irodori_base_url) throw new Error("irodori provider requires irodori_base_url");
    await updateVoice({
      baseUrl: eps.irodori_base_url,
      id: option.id,
      refUrl: option.ref_url,
      fetch: f,
    });
  };
  // BYO-voice import: pick file → copy → register in irodori → add option + select (mirrors swapSpeaker's register-then-select).
  // Cancel (null) is silently ignored. On register failure (server down / unusable clip), delete the orphan copy and throw
  // without adding the option — prior selection stays as-is (no recovery needed since registration fails before the store commit).
  const importVoice = async (): Promise<void> => {
    const option = await importVoiceFromFile();
    if (option === null) return; // cancel
    try {
      const f = await selectFetch();
      const eps = getEndpoints();
      if (!eps.irodori_base_url) throw new Error("irodori provider requires irodori_base_url");
      // ref_url is an asset:// URL — resolveRef passes it through as-is and POSTs the clip.
      await ensureRegistered({
        baseUrl: eps.irodori_base_url,
        id: option.id,
        refUrl: option.ref_url,
        fetch: f,
      });
    } catch (err) {
      // Remove the orphan copy — don't swallow a failure, surface it as a warning (the original error is still thrown).
      await removeOrphanVoice(option.id, removeUserVoiceFile, (e) =>
        log.warn("orphan_voice_cleanup_failed", { error: String(e) }),
      );
      log.error("imported_voice_register_failed", { error: String(err) });
      throw err;
    }
    speakerSelection.addUserVoice(option);
    speakerSelection.select(option.id);
  };
  // Announce cross-window so the speaker picked in this window reflects in the settings-window UI.
  speakerSelection.subscribe(broadcastSettings);
  return { speakerSelection, swapSpeaker, refreshSpeaker, importVoice };
}

/**
 * Window-sit drop + ctrl+wheel resize producers, plus the agent loopback ingress bind.
 * Tauri-only — getCurrentWindow()/invoke/listen require the Tauri runtime; in a plain browser
 * (Vite dev) this is skipped so bootstrap continues. Owns its own HMR teardown.
 */
export function wireWindowSources(deps: {
  bus: EventBus;
  renderer: Renderer;
  agentNotifySettings: { get(): AgentNotifySettings };
  log: Logger;
}): void {
  const { bus, renderer, agentNotifySettings, log } = deps;
  if (!isTauri()) return;
  let windowDropSource: ReturnType<typeof createWindowDropSource> | null = null;
  let windowResizeSource: ReturnType<typeof createWindowResizeSource> | null = null;
  // Guard teardown/async-assign race: cleanup may run before the IIFE assigns.
  let windowDropDisposed = false;
  if (import.meta.env.DEV) {
    import.meta.hot?.dispose(() => {
      windowDropDisposed = true;
      windowDropSource?.stop();
      windowResizeSource?.stop();
    });
  }
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    // Only bind loopback ingress when watcher on. Restart-to-apply:
    // toggling enable/port takes effect on next launch (no live rebind).
    if (agentNotifySettings.get().enabled) {
      void invoke("start_agent_ingress", { port: agentNotifySettings.get().port }).catch((e) =>
        log.warn("start_agent_ingress_failed", { error: String(e) }),
      );
    }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const { listen } = await import("@tauri-apps/api/event");
    windowDropSource = createWindowDropSource({
      bus,
      renderer,
      invoke: (cmd) => invoke(cmd) as Promise<WindowRect[]>,
      getWindow: getCurrentWindow,
      listen: listen as never,
    });
    const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
    windowResizeSource = createWindowResizeSource({
      renderer,
      getWindow: () => {
        const win = getCurrentWindow();
        return {
          outerPosition: () => win.outerPosition(),
          outerSize: () => win.outerSize(),
          scaleFactor: () => win.scaleFactor(),
          async setBoundsLogical(pos, size) {
            await win.setSize(new LogicalSize(size.width, size.height));
            await win.setPosition(new LogicalPosition(pos.x, pos.y));
          },
        };
      },
    });
    if (windowDropDisposed) {
      windowDropSource.stop();
      return;
    }
    await windowDropSource.start();
    windowResizeSource.start();
  })().catch((err) =>
    log.warn("window_drop_source_start_failed", {
      degrade: true,
      error: String(err),
    }),
  );
}

/**
 * tier2 utterance candidate sources: proactive.<id> (idle dramatization) + schedule.<id>
 * (time-of-day greeting) + agent.done/catchup + signals.push/catchup, all over the presence gate.
 * Created and started; the started refs are returned for interaction-notes and teardown.
 */
export function wireDispatcherSources(deps: {
  bus: EventBus;
  presenceSettings: { get(): PresenceSettings };
  proactiveSettings: { get(): ProactiveSettings };
  scheduleSettings: { get(): ScheduleSettings };
  agentNotifySettings: { get(): AgentNotifySettings };
}): {
  proactiveSource: ProactiveSource;
  scheduleSource: ScheduleSource;
  agentSource: ReturnType<typeof createAgentSource>;
  signalsSource: SignalsSource;
} {
  const { bus, presenceSettings, proactiveSettings, scheduleSettings, agentNotifySettings } = deps;
  const proactiveSource = createProactiveSource({
    bus,
    present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
    getCues: () => proactiveSettings.get().entries,
    isEnabled: () => proactiveSettings.get().enabled,
  });
  void proactiveSource.start();
  const scheduleSource = createScheduleSource({
    bus,
    present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
    getCues: () => scheduleSettings.get().entries,
    isEnabled: () => scheduleSettings.get().enabled,
  });
  void scheduleSource.start();
  const agentSource = createAgentSource({
    bus,
    present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
    isEnabled: () => agentNotifySettings.get().enabled,
  });
  void agentSource.start();
  const signalsSource = createSignalsSource({
    bus,
    present_max_idle_ms: presenceSettings.get().present_max_idle_ms,
    isEnabled: () => agentNotifySettings.get().enabled,
  });
  void signalsSource.start();
  return { proactiveSource, scheduleSource, agentSource, signalsSource };
}

/**
 * Global summon hotkey (Tauri-only — skipped in browser dev). Registers the configured
 * accelerator OS-globally; on fire, show+focus the window then summon input. Registration
 * failure fails soft (summon-hotkey warns, treats as inactive). onReady hands the handle
 * back for hot-reload re-apply. Owns its own HMR teardown.
 */
export function wireSummonHotkey(deps: {
  surfaces: Pick<Surfaces, "summonInput" | "isInputOpen">;
  accelerator: string;
  onReady: (hotkey: SummonHotkey) => void;
  log: Logger;
}): void {
  const { surfaces, accelerator, onReady, log } = deps;
  if (!isTauri()) return;
  void (async () => {
    const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const summonHotkey = createSummonHotkey({
      register,
      unregister,
      // On macOS, include background app activation, bring forward (show before hidden).
      focusWindow: async () => {
        const win = getCurrentWindow();
        await win.show();
        await win.setFocus();
      },
      summonInput: () => surfaces.summonInput(),
      isInputOpen: () => surfaces.isInputOpen(),
    });
    onReady(summonHotkey);
    await summonHotkey.apply(accelerator);
    if (import.meta.env.DEV) {
      import.meta.hot?.dispose(() => void summonHotkey.dispose());
    }
  })().catch((err) => log.warn("summon_hotkey_wire_failed", { error: String(err) }));
}
