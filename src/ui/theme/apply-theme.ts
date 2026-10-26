import type { createThemeSettings } from "../../settings/appearance/theme-settings";

type ThemeStore = Pick<ReturnType<typeof createThemeSettings>, "get" | "subscribe">;

/** Resolves system through OS appearance and follows the store and OS on the window root. */
export function applyTheme(deps: {
  store: ThemeStore;
  root: HTMLElement;
  matchMedia?: (q: string) => MediaQueryList;
  // Decorated windows hand in the native title-bar setter.
  setNativeTheme?: (theme: "light" | "dark") => Promise<void>;
}): () => void {
  const { store, root } = deps;
  const matchMedia = deps.matchMedia ?? globalThis.matchMedia?.bind(globalThis);
  const media = matchMedia?.("(prefers-color-scheme: dark)");
  const reflect = (): void => {
    const { theme } = store.get();
    const resolved = theme === "system" ? (media?.matches ? "hearth" : "dawn") : theme;
    root.dataset.theme = resolved;
    void deps.setNativeTheme?.(resolved === "hearth" ? "dark" : "light");
  };
  reflect();
  const unsubscribe = store.subscribe(reflect);
  media?.addEventListener("change", reflect);
  return () => {
    unsubscribe();
    media?.removeEventListener("change", reflect);
  };
}
