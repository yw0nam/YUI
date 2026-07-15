/** Bootstrap wiring helpers extracted from main.ts: VRM + speaker selection stores and their swap/import flows. */
import { resolveAssetUrl, resolveUserFileSrc } from "./io/asset-url";
import { selectFetch } from "./io/chat-client";
import { ensureRegistered, updateVoice } from "./io/irodori-voices";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  type SpeakerOption,
} from "./io/speaker-selection";
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
import type { Logger } from "./logger";
import type { Renderer, VrmLoadResult } from "./renderer";

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
