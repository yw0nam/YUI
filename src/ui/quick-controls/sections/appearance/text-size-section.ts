import type { Logger } from "../../../../logger";
import {
  type createTextSizeSettings,
  TEXT_SIZES,
} from "../../../../settings/appearance/text-size-settings";
import { createStoreSegment } from "../../store-segment";
import "./text-size-section.css";

export function createTextSizeSection(deps: {
  root: HTMLElement;
  textSizeSettings: ReturnType<typeof createTextSizeSettings>;
  isOpen: () => boolean;
  log: Logger;
}) {
  const { root, textSizeSettings, isOpen, log } = deps;
  return createStoreSegment({
    segment: root.querySelector<HTMLElement>(".yui-textsize-seg")!,
    values: TEXT_SIZES,
    get: () => textSizeSettings.get().scale,
    set: (scale) => {
      textSizeSettings.setScale(scale);
      log.info("text_size_change", { scale });
    },
    subscribe: textSizeSettings.subscribe,
    isOpen,
  });
}
