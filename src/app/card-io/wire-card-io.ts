/**
 * The card's settings-panel ports: io's file steps and settings' preset creator, bound to one
 * registry. The settings window's wiring spreads this result.
 */

import type { AvatarOption } from "../../config/validators/avatar/types";
import { importCardFromFile } from "../../io/assets/card/card-import";
import {
  pickPresetPhoto,
  removeCardThumbnail,
  retainFramedThumbnail,
} from "../../io/assets/card/card-thumbnail";
import {
  exportCardPng,
  exportPresetFile,
  inspectPresetVrm,
} from "../../io/assets/preset-file/preset-file-export";
import { removeUserVrm } from "../../io/assets/vrm-import";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import { removeUserVoice } from "../../io/voice/voices/voice-import";
import { createPresetFromCard } from "../../settings/preset/import-card-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { isTauri } from "../../tauri-env";
import { getLocale } from "../../ui/i18n";
import type { CardIoPorts } from "../../ui/quick-controls/sections/card/card-io";
import { importPreset } from "./import-preset";

export interface WireCardIoDeps {
  registry: PresetRegistry;
  vrmSelection: {
    list(): AvatarOption[];
    addUserOption(option: AvatarOption): void;
    removeUserOption(id: string): void;
  };
  /** The speaker store, for dropping a rolled-back import's list entry. */
  speakerSelection: Pick<ReturnType<typeof createSpeakerSelection>, "removeUserOption">;
  /** Deletes a voice's server entry and its local clip. */
  removeVoice(id: string): Promise<void>;
  registerCopiedVoice(copied: SpeakerOption & { source: "user" }, label: string): Promise<string>;
}

export function wireCardIo(deps: WireCardIoDeps): CardIoPorts {
  const { registry, vrmSelection } = deps;
  return {
    importPreset: () =>
      importPreset({
        importCard: importCardFromFile,
        registerCopiedVoice: deps.registerCopiedVoice,
        removeUserVoice,
        removeUserVrm,
        vrmSelection,
        // The server voice and its folder leave first; then the store entry follows.
        discardVoice: async (id) => {
          await deps.removeVoice(id);
          deps.speakerSelection.removeUserOption(id);
        },
        createPresetFromCard: (input) => {
          const { thumbnailTempId } = input;
          return createPresetFromCard({
            ...input,
            registry,
            fillerLocale: getLocale(),
            ...(thumbnailTempId
              ? {
                  retainThumbnail: (presetId: string) =>
                    retainFramedThumbnail(thumbnailTempId, presetId),
                  discardThumbnail: async (presetId: string) => {
                    // One failed removal must not skip the other.
                    await Promise.allSettled([
                      removeCardThumbnail(thumbnailTempId),
                      removeCardThumbnail(presetId),
                    ]);
                  },
                }
              : {}),
          });
        },
      }),
    exportPresetFile: (request) => exportPresetFile(request),
    exportCardPng: (defaultName, cardJson, presetId) =>
      exportCardPng(defaultName, cardJson, presetId),
    inspectPresetVrm: (id) => inspectPresetVrm(id),
    removeCardThumbnail: (id) => removeCardThumbnail(id),
    ...(isTauri() ? { pickPresetPhoto: (presetId: string) => pickPresetPhoto(presetId) } : {}),
  };
}
