import type { Logger } from "../../../../logger";
import { type createThemeSettings, THEMES } from "../../../../settings/appearance/theme-settings";
import { createStoreSegment } from "../../store-segment";

export function createAppearanceSection(deps: {
  root: HTMLElement;
  themeSettings: ReturnType<typeof createThemeSettings>;
  isOpen: () => boolean;
  log: Logger;
}) {
  const { root, themeSettings, isOpen, log } = deps;
  return createStoreSegment({
    segment: root.querySelector<HTMLElement>(".yui-theme-seg")!,
    values: THEMES,
    get: () => themeSettings.get().theme,
    set: (theme) => {
      themeSettings.setTheme(theme);
      log.info("theme_change", { theme });
    },
    subscribe: themeSettings.subscribe,
    isOpen,
  });
}
