import type { createTextSizeSettings } from "../../settings/appearance/text-size-settings";

type TextSizeStore = Pick<ReturnType<typeof createTextSizeSettings>, "get" | "subscribe">;

/** Sets --yui-text-scale on the window root and follows the store. */
export function applyTextScale(deps: { store: TextSizeStore; root: HTMLElement }): () => void {
  const { store, root } = deps;
  const reflect = (): void => {
    root.style.setProperty("--yui-text-scale", String(store.get().scale));
  };
  reflect();
  return store.subscribe(reflect);
}
