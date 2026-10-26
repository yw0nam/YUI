/**
 * The card's settings-panel ports: io's file steps and settings' preset creator, bound to one
 * registry. The settings window's wiring spreads this result.
 */

import type { Card } from "../../config/validators/persona/types";
import { exportCardToFile } from "../../io/assets/card/card-export";
import { type ImportedCard, importCardFromFile } from "../../io/assets/card/card-import";
import {
  pickPresetPhoto,
  removeCardThumbnail,
  retainFramedThumbnail,
} from "../../io/assets/card/card-thumbnail";
import { createPresetFromCard } from "../../settings/preset/import-card-preset";
import type { PresetRegistry } from "../../settings/preset/preset-registry";
import { isTauri } from "../../tauri-env";
import { getLocale } from "../../ui/i18n";

export interface CardIoPorts {
  importCard: () => Promise<ImportedCard | null>;
  exportCard: (text: string, fileName: string) => Promise<"written" | "cancelled">;
  createPresetFromCard: (card: Card, thumbnailTempId?: string) => Promise<string>;
  removeCardThumbnail: (id: string) => Promise<void>;
  /** Absent outside Tauri, where there is no native picker. */
  pickPresetPhoto?: (presetId: string) => Promise<string | null>;
}

export function wireCardIo(registry: PresetRegistry): CardIoPorts {
  return {
    importCard: () => importCardFromFile(),
    exportCard: (text, fileName) => exportCardToFile(text, fileName),
    createPresetFromCard: (card, thumbnailTempId) =>
      createPresetFromCard({
        registry,
        card,
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
      }),
    removeCardThumbnail: (id) => removeCardThumbnail(id),
    ...(isTauri() ? { pickPresetPhoto: (presetId: string) => pickPresetPhoto(presetId) } : {}),
  };
}
