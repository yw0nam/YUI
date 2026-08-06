/**
 * Refetches the irodori server's voice list into a speaker store's manifest.
 *
 * The irodori server is the source of truth for the speaker list — YUI carries no bundled
 * catalog. Both windows need this (the pet window on boot / endpoints hot-reload / panel open,
 * the settings window on boot / panel open), so it lives here rather than being written twice.
 */

import type { Logger } from "../logger";
import { selectFetch } from "./chat-client";
import { listVoices } from "./irodori-voices";
import type { SpeakerOption } from "./speaker-selection";

/** The endpoints fields this needs, or null when config is not loaded yet. */
type VoiceListEndpoints = { irodori_base_url?: string; irodori_speaker?: string } | null;

/** The slice of the speaker store the refresher touches. */
interface SpeakerManifestTarget {
  getOptions: () => SpeakerOption[];
  setManifest: (manifest: { available: SpeakerOption[]; defaultValue: string }) => void;
}

export function createVoiceListRefresh(deps: {
  /** May throw or return null when config is not ready — both are treated as "skip this refresh". */
  getEndpoints: () => VoiceListEndpoints;
  speakerSelection: SpeakerManifestTarget;
  log: Logger;
}): () => Promise<void> {
  const { getEndpoints, speakerSelection, log } = deps;
  // Discards a stale (out-of-order) resolution so it can't clobber a newer manifest — the triggers
  // (boot, endpoints hot-reload, panel open) fire with no sequencing between them.
  let generation = 0;

  return async function refreshVoiceList(): Promise<void> {
    try {
      const eps = getEndpoints();
      if (!eps?.irodori_base_url) return;
      const mine = ++generation;
      const f = await selectFetch();
      const ids = await listVoices({ baseUrl: eps.irodori_base_url, fetch: f, logger: log });
      if (mine !== generation) return; // superseded by a later refresh
      // A configured default the server doesn't (yet) have must not be conjured into existence.
      const defaultId =
        eps.irodori_speaker && ids.includes(eps.irodori_speaker) ? eps.irodori_speaker : "";
      // A user-imported voice registers to the server under its own id — once relisted it would
      // collide as a "bundled" entry and the store's bundled-wins rule would strip the user's
      // richer option (label + asset:// ref_url). Exclude user-owned ids from the bundled manifest
      // instead. Read after the fetch, so an import that landed mid-flight is respected.
      const userIds = new Set(
        speakerSelection
          .getOptions()
          .filter((o) => o.source === "user")
          .map((o) => o.id),
      );
      speakerSelection.setManifest({
        available: ids
          .filter((id) => !userIds.has(id))
          .map((id) => ({ id, label: id, ref_url: "" })),
        defaultValue: defaultId,
      });
    } catch (err) {
      log.warn("voice_list_refresh_failed", { error: String(err) });
    }
  };
}
