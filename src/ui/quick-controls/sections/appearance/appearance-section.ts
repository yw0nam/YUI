import type { Logger } from "../../../../logger";
import { type createThemeSettings, THEMES } from "../../../../settings/appearance/theme-settings";
import { handleSegmentKeydown } from "../../seg-keyboard";

export function createAppearanceSection(deps: {
  root: HTMLElement;
  themeSettings: ReturnType<typeof createThemeSettings>;
  isOpen: () => boolean;
  log: Logger;
}) {
  const { root, themeSettings, isOpen, log } = deps;
  const segment = root.querySelector<HTMLElement>(".yui-theme-seg")!;
  const buttons = [...segment.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")];
  const reflect = (): void => {
    const index = THEMES.indexOf(themeSettings.get().theme);
    buttons.forEach((button, i) => {
      button.setAttribute("aria-checked", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  };
  const select = (index: number, focus = false): void => {
    const selected = Math.min(THEMES.length - 1, Math.max(0, index));
    const theme = THEMES[selected];
    themeSettings.setTheme(theme);
    log.info("theme_change", { theme });
    if (focus) buttons[selected].focus();
  };
  const click = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!button) return;
    select(buttons.indexOf(button));
  };
  const keydown = (event: KeyboardEvent): void => {
    handleSegmentKeydown(event, buttons, {
      length: THEMES.length,
      getBaseIndex: () => THEMES.indexOf(themeSettings.get().theme),
      onNavigate: select,
    });
  };
  const unsubscribe = themeSettings.subscribe(() => {
    if (isOpen()) reflect();
  });
  segment.addEventListener("click", click);
  segment.addEventListener("keydown", keydown);
  return {
    reflect,
    dispose(): void {
      unsubscribe();
      segment.removeEventListener("click", click);
      segment.removeEventListener("keydown", keydown);
    },
  };
}
