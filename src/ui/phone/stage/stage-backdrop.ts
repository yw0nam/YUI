/**
 * Phone stage backdrop — mirrors the stage background store onto the phone root: the user image
 * as a custom property under a class the stylesheet draws, or neither for the default stage.
 * An image is applied only once it decodes; a file that cannot load falls back to the default.
 */

import { resolveUserFileSrc } from "../../../config/asset-url";
import { decodeImage } from "../../../io/assets/stage/decode-image";
import type {
  StageBackground,
  StageBackgroundStore,
} from "../../../io/assets/stage/stage-background";
import type { Logger } from "../../../logger";

const IMAGE_CLASS = "has-stage-image";
const IMAGE_PROPERTY = "--yui-stage-image";

/** A CSS string literal's quotes, backslashes and line breaks escaped. */
const cssUrl = (url: string): string =>
  `url("${url.replace(/[\\"]/g, "\\$&").replace(/\r?\n/g, "\\a ")}")`;

export function createStageBackdrop(deps: {
  /** The phone root the stylesheet draws the image on. */
  root: HTMLElement;
  store: Pick<StageBackgroundStore, "get" | "subscribe" | "clearImage">;
  resolveSrc?: (path: string) => Promise<string>;
  decodeImage?: (url: string) => Promise<void>;
  log: Logger;
}): { dispose(): void } {
  const { root, store, log } = deps;
  const resolveSrc = deps.resolveSrc ?? resolveUserFileSrc;
  const decode = deps.decodeImage ?? decodeImage;
  // Each apply takes a number; a decode finishing under an older one is dropped.
  let latest = 0;

  function clear(): void {
    root.classList.remove(IMAGE_CLASS);
    root.style.removeProperty(IMAGE_PROPERTY);
  }

  async function apply(state: StageBackground): Promise<void> {
    const request = ++latest;
    if (state.mode !== "image" || !state.image) {
      clear();
      return;
    }
    try {
      const url = await resolveSrc(state.image.path);
      if (url === "") throw new Error("stage image url unavailable");
      await decode(url);
      if (request !== latest) return;
      root.style.setProperty(IMAGE_PROPERTY, cssUrl(url));
      root.classList.add(IMAGE_CLASS);
    } catch (err) {
      if (request !== latest) return;
      log.warn("stage_image_load_failed", { error: String(err) });
      store.clearImage();
    }
  }

  const unsubscribe = store.subscribe((state) => void apply(state));
  void apply(store.get());

  return {
    dispose(): void {
      unsubscribe();
      latest++;
      clear();
    },
  };
}
