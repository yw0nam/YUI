/**
 * Preset-file import orchestration — the card section's one import action: the native file
 * step, the copied voice's registration with its own TTS, the VRM list entry, the preset
 * creation, and the rollback of exactly what this import created.
 */

import type { AvatarOption } from "../../config/validators/avatar/types";
import type { ImportedCard } from "../../io/assets/card/card-import";
import type { SpeakerOption } from "../../io/voice/voices/speaker-selection";
import type { CreatePresetFromCardInput } from "../../settings/preset/import-card-preset";

/** The one-shot notice the card section reads on its next mount after the activation reload. */
export const CARD_IMPORT_NOTICE_KEY = "yui.card-import-notice";

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
  createPresetFromCard(input: CreatePresetFromCardInput): Promise<string>;
  /** One-shot notice storage across the activation reload; defaults to sessionStorage. */
  noticeStorage?: Pick<Storage, "setItem" | "removeItem">;
}

export interface ImportPresetResult {
  presetId: string;
}

export async function importPreset(_deps: ImportPresetDeps): Promise<ImportPresetResult | null> {
  throw new Error("importPreset not implemented");
}
