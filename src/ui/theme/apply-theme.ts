import type { createThemeSettings } from "../../settings/appearance/theme-settings";

type ThemeStore = Pick<ReturnType<typeof createThemeSettings>, "get" | "subscribe">;

export function applyTheme(_deps: {
  store: ThemeStore;
  root: HTMLElement;
  matchMedia?: (q: string) => MediaQueryList;
}): () => void {
  return () => {};
}
