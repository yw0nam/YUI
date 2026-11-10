/**
 * The card's settings-panel ports: io's file steps and settings' preset creator, bound to one
 * registry. The settings window's wiring spreads this result.
 */

import { importCardFromDrop, importCardFromFile } from "../../io/assets/card/card-import";
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
  UserSpeakerOption,
} from "../../io/voice/voices/speaker-selection";
import { createPresetFromCard } from "../../settings/preset/import-card-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { isTauri } from "../../tauri-env";
import { getLocale } from "../../ui/i18n";
import type { CardIoPorts } from "../../ui/quick-controls/sections/card/card-io";
import type { ImportGate } from "./import-gate";
import { type ImportPresetDeps, importPreset } from "./import-preset";

export interface WireCardIoDeps {
  registry: PresetRegistry;
  vrmSelection: ImportPresetDeps["vrmSelection"];
  /** The speaker store, for dropping a rolled-back import's list entry. */
  speakerSelection: Pick<ReturnType<typeof createSpeakerSelection>, "removeUserOption">;
  /** Deletes a voice's server entry and its local clip. */
  removeVoice(id: string): Promise<void>;
  registerCopiedVoice(copied: UserSpeakerOption, label: string): Promise<string>;
  /** This window's one card import at a time, shared by the picker and the dropped file. */
  gate: ImportGate;
}

export function wireCardIo(deps: WireCardIoDeps): CardIoPorts {
  const { registry, vrmSelection, gate } = deps;
  const shared: Omit<ImportPresetDeps, "importCard"> = {
    registerCopiedVoice: deps.registerCopiedVoice,
    removeUserVrm,
    vrmSelection,
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
  };
  return {
    importPreset: () => gate.run(() => importPreset({ ...shared, importCard: importCardFromFile })),
    importDroppedPreset: () =>
      gate.run(async () => {
        const imported = await importPreset({ ...shared, importCard: importCardFromDrop });
        // A dropped file has no picker to dismiss, so no import ends without a result.
        if (!imported) throw new Error("import failed");
        return imported;
      }),
    importBusy: gate,
    exportPresetFile: (request) => exportPresetFile(request),
    exportCardPng: (defaultName, cardJson, presetId) =>
      exportCardPng(defaultName, cardJson, presetId),
    inspectPresetVrm: (id) => inspectPresetVrm(id),
    removeCardThumbnail: (id) => removeCardThumbnail(id),
    ...(isTauri() ? { pickPresetPhoto: (presetId: string) => pickPresetPhoto(presetId) } : {}),
  };
}
