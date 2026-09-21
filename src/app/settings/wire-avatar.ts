/** VRM and speaker selection stores, their swap/import flows, and the effective endpoints derived from overrides. */

import type { AppConfig } from "../../config/load";
import type { EndpointsConfig } from "../../contract";
import { resolveAssetUrl, resolveUserFileSrc } from "../../io/assets/asset-url";
import { removeOrphanImport } from "../../io/assets/user-asset-import";
import { importVrmFromFile, removeUserVrm } from "../../io/assets/vrm-import";
import {
  createVrmSelection,
  localStorageUserVrmStorage,
  localStorageVrmStorage,
} from "../../io/assets/vrm-selection";
import { selectFetch } from "../../io/chat/chat-client";
import { type EndpointOverrides, mergeEndpoints } from "../../io/settings/endpoints-settings";
import { enabledIdleVariants } from "../../io/settings/idle-motion-settings";
import type { SettingsStores } from "../../io/settings/settings-stores";
import {
  createSpeakerSelection,
  localStorageSpeakerStorage,
  localStorageUserSpeakerStorage,
  nextRevision,
  type SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import { deleteVoice, upsertVoice } from "../../io/voice/voices/tts-voices";
import { removeUserVoice as removeUserVoiceFile } from "../../io/voice/voices/voice-import";
import { createVoiceImportFlow } from "../../io/voice/voices/voice-import-flow";
import { createVoiceListRefresh } from "../../io/voice/voices/voice-list-refresh";
import type { Logger } from "../../logger";
import type { Renderer, VrmLoadResult } from "../../renderer";

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
    defaultValue: "/vrms/Sendagaya_Shino.vrm",
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
      await removeOrphanImport(option.id, removeUserVrm, (e) =>
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

/**
 * Effective endpoints for a window whose config load is best-effort: user overrides layered on the
 * bundled config, or null while the config has not loaded. Both sides are read per call, so a live
 * override edit takes effect without rewiring. Network consumers read through this — a URL set only
 * as an override still has to reach them.
 */
export function createEffectiveEndpoints(deps: {
  getBundled: () => EndpointsConfig | null;
  getOverrides: () => EndpointOverrides;
}): () => EndpointsConfig | null {
  return () => {
    const bundled = deps.getBundled();
    return bundled ? mergeEndpoints(bundled, deps.getOverrides()) : null;
  };
}

export function wireSpeakerSelection(deps: {
  /** Effective endpoints, or null while a best-effort config load has not finished. */
  getEndpoints: () => { tts_base_url?: string; tts_speaker?: string } | null;
  /** Resolves the TTS server key (Bearer). Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  log: Logger;
  broadcastSettings: () => void;
}): {
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Pick step: opens the file picker, returns the source path + a seed name for the naming row (null on cancel). */
  pickVoiceImport: () => Promise<{ srcPath: string; seedName: string } | null>;
  /** Commit step: copy + upload under `name` (overwrite-aware) → add option + select. */
  commitVoiceImport: (srcPath: string, name: string) => Promise<void>;
  removeVoice: (id: string) => Promise<void>;
  refreshVoiceList: () => Promise<void>;
} {
  const { getEndpoints, getApiKey, log, broadcastSettings } = deps;
  // Speaker selection store. Starts with an empty fallback since config is not loaded yet —
  // the panel is needed early. After config loads, refreshVoiceList injects the server-reported
  // voice list and default.
  const speakerSelection = createSpeakerSelection({
    defaultValue: "",
    storage: localStorageSpeakerStorage(),
    userStorage: localStorageUserSpeakerStorage(),
  });
  // Voices are server-side persistent, so picking one is a store commit and nothing else.
  const swapSpeaker = async (option: SpeakerOption): Promise<void> => {
    speakerSelection.select(option.id);
  };
  // Re-upload the reference clip — server-side force-refresh only, does not change the selection.
  const refreshSpeaker = async (option: SpeakerOption): Promise<void> => {
    const baseUrl = getEndpoints()?.tts_base_url;
    if (!baseUrl) throw new Error("voice refresh requires tts_base_url");
    const f = await selectFetch();
    await upsertVoice({
      baseUrl,
      id: option.id,
      refUrl: option.ref_url,
      fetch: f,
      getApiKey,
      logger: log,
    });
    // The clip behind an unchanged id was replaced — bump the persisted revision so every
    // window's filler cache key moves with it.
    speakerSelection.addUserOption({
      ...option,
      source: "user",
      revision: nextRevision(speakerSelection.list(), option.id),
    });
  };
  const { pickVoiceImport, commitVoiceImport } = createVoiceImportFlow({
    getTtsBaseUrl: () => getEndpoints()?.tts_base_url,
    getApiKey,
    speakerSelection,
    log,
  });
  // Deletes the server-side voice; a user-imported one also drops its local clip.
  const removeVoice = async (id: string): Promise<void> => {
    const baseUrl = getEndpoints()?.tts_base_url;
    if (!baseUrl) throw new Error("voice delete requires tts_base_url");
    const f = await selectFetch();
    await deleteVoice({ baseUrl, id, fetch: f, getApiKey, logger: log });
    const source = speakerSelection.list().find((o) => o.id === id)?.source;
    if (source === "user") await removeUserVoiceFile(id);
  };
  // Announce cross-window so the speaker picked in this window reflects in the settings-window UI.
  speakerSelection.subscribe(broadcastSettings);
  // A fresh server with no voices yields a genuinely empty available[] — expected, not an error
  // (selection-store then has nothing to select).
  const refreshVoiceList = createVoiceListRefresh({
    getEndpoints,
    getApiKey,
    speakerSelection,
    reuploadUserVoice: refreshSpeaker,
    log,
  });
  return {
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    pickVoiceImport,
    commitVoiceImport,
    removeVoice,
    refreshVoiceList,
  };
}

export function applyAvatarConfig(deps: {
  cfg: AppConfig;
  getConfig: () => AppConfig;
  renderer: Renderer;
  idleMotionSettings: Pick<SettingsStores["idleMotionSettings"], "get" | "subscribe">;
  vrmSelection: Pick<ReturnType<typeof createVrmSelection>, "setManifest">;
  register: (teardown: () => void) => void;
}): void {
  const { cfg, getConfig, renderer, idleMotionSettings, vrmSelection, register } = deps;
  renderer.setEmotionRegistry(cfg.emotionRegistry);
  // Ambient idle pool = catalog ∩ the user's selection; applied before the registry so the
  // first baseline play already honors it, then re-applied live on every store change.
  const applyIdleVariants = (): void => {
    const pool = getConfig().motions.idle;
    if (pool) renderer.setIdleVariants(enabledIdleVariants(pool, idleMotionSettings.get()));
  };
  applyIdleVariants();
  register(idleMotionSettings.subscribe(applyIdleVariants));
  renderer.setMotionRegistry(cfg.motions);
  renderer.setFraming(cfg.avatar.framing);
  renderer.setGaze(cfg.avatar.gaze);
  renderer.setHitTestThreshold(cfg.avatar.hit_test.alpha_threshold);
  vrmSelection.setManifest({
    available: cfg.avatar.available,
    defaultValue: cfg.avatar.vrm_url,
  });
}
