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
  setManifest: (manifest: {
    available: SpeakerOption[];
    defaultValue: string;
    hideUser: boolean;
  }) => void;
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

  return async function refreshVoiceList(): Promise<void> {
    try {
      const eps = getEndpoints();
      if (!eps?.tts_base_url) return;
      const api = VOICE_APIS[ttsProviderOf(eps)];
      if (!api) return;
      const mine = ++generation;
      const f = await selectFetch();
      const ids = await api.list({
        baseUrl: eps.tts_base_url,
        fetch: f,
        getApiKey,
        logger: log,
      });
      if (mine !== generation) return; // superseded by a later refresh
      // A failed list is not an empty server — keep the current manifest and user clips as they are.
      if (ids === null) return;
      // A configured default the server doesn't (yet) have must not be conjured into existence.
      const defaultId = eps.tts_speaker && ids.includes(eps.tts_speaker) ? eps.tts_speaker : "";
      // A provider that takes no uploads cannot speak a user import, so imports stay stored but unlisted.
      const takesUploads = api.upsert !== undefined;
      // A user-imported voice is uploaded to the server under its own id — once relisted it would
      // collide as a "bundled" entry and the store's bundled-wins rule would strip the user's
      // richer option (label + asset:// ref_url). Exclude user-owned ids from the bundled manifest
      // instead. Read after the fetch, so an import that landed mid-flight is respected.
      const userIds = new Set(takesUploads ? speakerSelection.listUser().map((o) => o.id) : []);
      speakerSelection.setManifest({
        available: ids
          .filter((id) => !userIds.has(id))
          .map((id) => ({ id, label: id, ref_url: "" })),
        defaultValue: defaultId,
        hideUser: !takesUploads,
      });
      // Self-heal: a user-imported voice lives on the server as a reference clip, and a server
      // restart or swap loses it — every synth then 400s ("Unknown voice"). The local clip is the
      // source of truth, so push it back up instead of leaving the selection silently broken.
      // Only a provider that takes uploads gets one, so a provider switch never carries clips elsewhere.
      if (reuploadUserVoice && takesUploads) {
        const lost = speakerSelection
          .listUser()
          .filter((o) => o.ref_url.length > 0 && !ids.includes(o.id));
        for (const option of lost) {
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
 * provider. The override store notifies on every field's commit, so non-TTS edits (chat URL etc)
 * are filtered out here.
 */
export function wireVoiceListAutoRefresh(deps: {
  subscribe: (cb: () => void) => () => void;
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
  return deps.subscribe(() => {
    const next = key();
    if (next === null || next === last) return;
    last = next;
    void deps.refresh();
  });
}
