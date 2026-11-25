/** The name plate's turn state: responding from a line's begin to its end or hide, waiting while a card shows, thinking while busy. */

import type { Surfaces } from "../surfaces/surfaces";
import type { MessagePlate } from "./message-plate";

type Driven = Pick<Surfaces, "beginSpeech" | "endSpeech" | "hideSpeech" | "setBusy" | "setAsks">;

/** The same surfaces, with the plate following their speech, ask and busy state. */
export function withPlateState<S extends Driven>(
  plate: Pick<MessagePlate, "setLive" | "setBusy" | "setWaiting">,
  surfaces: S,
): S {
  return {
    ...surfaces,
    beginSpeech(...args: Parameters<Driven["beginSpeech"]>) {
      plate.setLive(true);
      surfaces.beginSpeech(...args);
    },
    endSpeech(...args: Parameters<Driven["endSpeech"]>) {
      plate.setLive(false);
      surfaces.endSpeech(...args);
    },
    hideSpeech() {
      plate.setLive(false);
      surfaces.hideSpeech();
    },
    setAsks(frames: Parameters<Driven["setAsks"]>[0]) {
      plate.setWaiting(frames.length > 0);
      surfaces.setAsks(frames);
    },
    setBusy(busy: boolean) {
      plate.setBusy(busy);
      surfaces.setBusy(busy);
    },
  };
}
