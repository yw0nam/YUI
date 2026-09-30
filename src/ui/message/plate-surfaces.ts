/**
 * Wraps the phone's Surfaces so speech and busy mirror into the name plate — the same mapping
 * the message window applies to its bridge ops, fed from a Surfaces instead.
 */

import type { Surfaces } from "../surfaces/surfaces";
import type { MessagePlate } from "./message-plate";

export function withPlate(
  surfaces: Surfaces,
  plate: Pick<MessagePlate, "setLive" | "setBusy">,
): Surfaces {
  return {
    ...surfaces,
    beginSpeech(): void {
      plate.setLive(true);
      surfaces.beginSpeech();
    },
    endSpeech(opts?: { defer?: boolean }): void {
      plate.setLive(false);
      surfaces.endSpeech(opts);
    },
    hideSpeech(): void {
      plate.setLive(false);
      surfaces.hideSpeech();
    },
    setBusy(busy: boolean): void {
      plate.setBusy(busy);
      surfaces.setBusy(busy);
    },
  };
}
