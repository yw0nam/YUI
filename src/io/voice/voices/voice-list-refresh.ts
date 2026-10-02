/**
 * Refetches the TTS server's voice list into a speaker store's manifest.
 *
 * The TTS server is the source of truth for the speaker list — YUI carries no bundled catalog.
 * Both windows need this (the pet window on boot / endpoints hot-reload / panel open, the
 * settings window on boot / panel open), so it lives here rather than being written twice.
 */

import { ttsProviderOf } from "../../../config/tts-provider";
import type { TtsProviderName } from "../../../contract";
import type { Logger } from "../../../logger";
import { selectFetch } from "../../chat/chat-client";
import type { SpeakerOption } from "./speaker-selection";
import { VOICE_APIS } from "./voice-apis";

/** The endpoints fields this needs, or null when config is not loaded yet. */
type VoiceListEndpoints = {
  tts_base_url?: string;
  tts_speaker?: string;
  tts_provider?: TtsProviderName;
} | null;

/** The slice of the speaker store the refresher touches. */
interface SpeakerManifestTarget {
  listUser: () => SpeakerOption[];
  setOwner: (provider: TtsProviderName) => void;
  setManifest: (manifest: { available: SpeakerOption[]; defaultValue: string }) => void;
}

export function createVoiceListRefresh(deps: {
  /** May throw or return null when config is not ready — both are treated as "skip this refresh". */
  getEndpoints: () => VoiceListEndpoints;
  /** Resolves the TTS server key (Bearer). Omitted/empty → no auth header. */
  getApiKey?: () => Promise<string | undefined>;
  speakerSelection: SpeakerManifestTarget;
  /** Re-uploads a user voice's local clip to the server (bumping its revision). */
  reuploadUserVoice?: (option: SpeakerOption) => Promise<void>;
  log: Logger;
}): () => Promise<void> {
  const { getEndpoints, getApiKey, speakerSelection, reuploadUserVoice, log } = deps;
  // Discards a stale (out-of-order) resolution so it can't clobber a newer manifest — the triggers
  // (boot, endpoints hot-reload, panel open) fire with no sequencing between them.
  let generation = 0;
  // The provider whose voices the manifest holds; its voices must not outlive a switch to another.
  let listedProvider: TtsProviderName | undefined;

  return async function refreshVoiceList(): Promise<void> {
    try {
      const eps = getEndpoints();
      if (!eps?.tts_base_url) return;
      const provider = ttsProviderOf(eps);
      const api = VOICE_APIS[provider];
      if (!api) return;
      // User voices belong to the provider that made them; only the live provider's are listed.
      speakerSelection.setOwner(provider);
      if (listedProvider !== undefined && provider !== listedProvider) {
        speakerSelection.setManifest({ available: [], defaultValue: "" });
        listedProvider = provider;
      }
      const mine = ++generation;
      const f = await selectFetch();
      const voices = await api.list({
        baseUrl: eps.tts_base_url,
        fetch: f,
        getApiKey,
        logger: log,
      });
      if (mine !== generation) return; // superseded by a later refresh
      // A failed list is not an empty server — keep the current manifest and user clips as they are.
      if (voices === null) return;
      const listedIds = voices.map((v) => v.id);
      // A configured default the server doesn't (yet) have must not be conjured into existence.
      const defaultId =
        eps.tts_speaker && listedIds.includes(eps.tts_speaker) ? eps.tts_speaker : "";
      // A user-imported voice is uploaded to the server under its own id — once relisted it would
      // collide as a "bundled" entry and the store's bundled-wins rule would strip the user's
      // richer option (label + asset:// ref_url). Exclude user-owned ids from the bundled manifest
      // instead. Read after the fetch, so an import that landed mid-flight is respected.
      const own = speakerSelection.listUser().filter((o) => o.provider === provider);
      const userIds = new Set(own.map((o) => o.id));
      speakerSelection.setManifest({
        available: voices
          .filter((v) => !userIds.has(v.id))
          .map((v) => ({ id: v.id, label: v.label ?? v.id, ref_url: "" })),
        defaultValue: defaultId,
      });
      listedProvider = provider;
      // Self-heal: a user-imported voice lives on the server as a reference clip, and a server
      // restart or swap loses it — every synth then 400s ("Unknown voice"). The local clip is the
      // source of truth, so push it back up instead of leaving the selection silently broken.
      // Only the provider's own clips, and only where an upload keeps the id — anywhere else it
      // would create a new voice each time.
      if (reuploadUserVoice && api.keepsId) {
        const lost = own.filter((o) => o.ref_url.length > 0 && !listedIds.includes(o.id));
        for (const option of lost) {
          if (mine !== generation) break; // a later refresh owns the store now
          try {
            await reuploadUserVoice(option);
            log.info("voice_reuploaded", { id: option.id });
          } catch (err) {
            log.warn("voice_reupload_failed", { id: option.id, error: String(err) });
          }
        }
      }
    } catch (err) {
      log.warn("voice_list_refresh_failed", { error: String(err) });
    }
  };
}

/**
 * Refetches the voice list when an endpoints-override commit changes the TTS URL, speaker or
 * provider, or the TTS key changes. The override store notifies on every field's commit, so non-TTS edits (chat URL etc)
 * are filtered out here.
 */
export function wireVoiceListAutoRefresh(deps: {
  subscribe: (cb: () => void) => () => void;
  /** The TTS key store's subscription; a server that refused the list may accept the new key. */
  subscribeKey?: (cb: () => void) => () => void;
  getEndpoints: () => VoiceListEndpoints;
  refresh: () => Promise<void>;
}): () => void {
  // getEndpoints throws until config loads — the pet window wires this before config.load(),
  // so an unreadable baseline is "unknown" (null), never a boot-killing exception.
  const key = (): string | null => {
    try {
      const eps = deps.getEndpoints();
      return [eps?.tts_base_url, eps?.tts_speaker, eps?.tts_provider].join("\u0000");
    } catch {
      return null;
    }
  };
  let last = key();
  const unsubscribe = deps.subscribe(() => {
    const next = key();
    if (next === null || next === last) return;
    last = next;
    void deps.refresh();
  });
  const unsubscribeKey = deps.subscribeKey?.(() => void deps.refresh());
  return () => {
    unsubscribe();
    unsubscribeKey?.();
  };
}
