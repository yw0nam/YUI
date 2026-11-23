/** The Plugins page: the Installed and Available sections over one external store. */

import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { CatalogSection } from "./catalog-section";
import { InstalledSection } from "./installed-section";
import { KeyedEnterProvider } from "./plugin-parts";
import type { PluginsState } from "./plugins-state";

export function PluginsPageView({ state }: { state: PluginsState }) {
  useSyncExternalStore(state.subscribe, state.version);
  // The page's unmount releases its state.
  useEffect(() => () => state.dispose(), [state]);
  // Blocks that mount after this commit fade in; the first commit's do not.
  const animate = useRef(false);
  useLayoutEffect(() => {
    animate.current = true;
  }, []);
  // Escape closes an open step 1 or remove confirm here, so the panel's own Escape does not close the window.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== "Escape") return;
    if (!state.escape()) return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <KeyedEnterProvider animate={animate}>
      <InstalledSection state={state} onKeyDown={onKeyDown} />
      <CatalogSection state={state} onKeyDown={onKeyDown} />
    </KeyedEnterProvider>
  );
}
