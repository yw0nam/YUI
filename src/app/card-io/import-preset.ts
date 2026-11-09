/**
 * Preset-file import orchestration — the card section's one import action: the native file
 * step, the copied voice's registration with its own TTS, the VRM list entry, the preset
 * creation, and the rollback of exactly what this import created.
 */

import type { AvatarOption } from "../../config/validators/avatar/types";
import type { Card } from "../../config/validators/persona/types";
import type { ImportedCard } from "../../io/assets/card/card-import";
import type { SpeakerOption } from "../../io/voice/voices/speaker-selection";
import { coercePhotoCrop, type PhotoCrop } from "../../settings/preset/photo-crop";
import { CARD_IMPORT_NOTICE_KEY } from "../../ui/quick-controls/sections/card/card-io";

/** The preset-creation inputs the orchestration owns; the wiring binds the registry and thumbnail steps. */
export interface ImportPresetCreateInput {
  card: Card;
  thumbnailTempId?: string;
  crop?: PhotoCrop;
  vrmId?: string | null;
  speakerId?: string | null;
}

export interface ImportPresetDeps {
  importCard(reservedVrmIds: string[], voiceStagingId: string): Promise<ImportedCard | null>;
  registerCopiedVoice(copied: SpeakerOption & { source: "user" }, label: string): Promise<string>;
  /** Removes a staged voice folder the native step claimed. Idempotent. */
  removeUserVoice(id: string): Promise<void>;
  /** Undoes one registered voice: the server voice and its folder, then the store entry. */
  discardVoice(id: string): Promise<void>;
  /** Deletes an imported VRM file. Idempotent. */
  removeUserVrm(id: string): Promise<void>;
  vrmSelection: {
    list(): AvatarOption[];
    addUserOption(option: AvatarOption): void;
    removeUserOption(id: string): void;
  };
  createPresetFromCard(input: ImportPresetCreateInput): Promise<string>;
  /** One-shot notice storage across the activation reload; defaults to sessionStorage. */
  noticeStorage?: Pick<Storage, "setItem" | "removeItem">;
}

export interface ImportPresetResult {
  presetId: string;
}

export async function importPreset(deps: ImportPresetDeps): Promise<ImportPresetResult | null> {
  const reservedVrmIds = deps.vrmSelection
    .list()
    .filter((o) => o.source === "bundled")
    .map((o) => o.id);
  const stagingId = `import-${crypto.randomUUID()}`;
  const imported = await deps.importCard(reservedVrmIds, stagingId);
  if (!imported) return null;

  let speakerId: string | null = null;
  let voiceFailed = false;
  if (imported.voice) {
    const copied: SpeakerOption & { source: "user" } = {
      id: imported.voice.stagedId,
      ref_url: imported.voice.refUrl,
      source: "user",
    };
    try {
      speakerId = await deps.registerCopiedVoice(copied, imported.voice.label);
    } catch {
      speakerId = null;
      voiceFailed = true;
      await deps.removeUserVoice(imported.voice.stagedId);
    }
  }

  let vrmId: string | null = null;
  let addedVrm: AvatarOption | undefined;
  const vrm = imported.vrm;
  if (vrm?.kind === "user") {
    addedVrm = { id: vrm.id, label: vrm.id, url: vrm.url, source: "user" };
    deps.vrmSelection.addUserOption(addedVrm);
    vrmId = vrm.id;
  } else if (vrm?.kind === "bundled" && deps.vrmSelection.list().some((o) => o.id === vrm.id)) {
    vrmId = vrm.id;
  }

  const notice = deps.noticeStorage ?? globalThis.sessionStorage;
  // The notice crosses the activation reload; the card section reads it on its next mount.
  if (voiceFailed) notice.setItem(CARD_IMPORT_NOTICE_KEY, "voice");

  try {
    const presetId = await deps.createPresetFromCard({
      card: imported.card,
      ...(imported.thumbnailTempId ? { thumbnailTempId: imported.thumbnailTempId } : {}),
      crop: coercePhotoCrop(imported.crop),
      // A preset file always names both keys — null clears the copy the preset arrived with.
      ...(imported.source === "yui" ? { vrmId, speakerId } : {}),
    });
    return { presetId };
  } catch (err) {
    notice.removeItem(CARD_IMPORT_NOTICE_KEY);
    // Roll back exactly what this import created; a failed step must not mask the import error.
    await Promise.allSettled([
      ...(addedVrm ? [deps.removeUserVrm(addedVrm.id)] : []),
      ...(speakerId !== null ? [deps.discardVoice(speakerId)] : []),
    ]);
    if (addedVrm) deps.vrmSelection.removeUserOption(addedVrm.id);
    throw err;
  }
}
