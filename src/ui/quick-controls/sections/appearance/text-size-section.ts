import type { Logger } from "../../../../logger";
import {
  type createTextSizeSettings,
  TEXT_SIZES,
} from "../../../../settings/appearance/text-size-settings";
import { handleSegmentKeydown } from "../../seg-keyboard";
import "./text-size-section.css";

export function createTextSizeSection(deps: {
  root: HTMLElement;
  textSizeSettings: ReturnType<typeof createTextSizeSettings>;
  isOpen: () => boolean;
  log: Logger;
}) {
  const { root, textSizeSettings, isOpen, log } = deps;
  const segment = root.querySelector<HTMLElement>(".yui-textsize-seg")!;
  const buttons = [...segment.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")];
  const current = (): number => TEXT_SIZES.indexOf(textSizeSettings.get().scale);
  const reflect = (): void => {
    const index = current();
    buttons.forEach((button, i) => {
      button.setAttribute("aria-checked", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  };
  const select = (index: number, focus = false): void => {
    const selected = Math.min(TEXT_SIZES.length - 1, Math.max(0, index));
    const scale = TEXT_SIZES[selected];
    textSizeSettings.setScale(scale);
    log.info("text_size_change", { scale });
    if (focus) buttons[selected].focus();
  };
  const click = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!button) return;
    select(buttons.indexOf(button));
  };
  const keydown = (event: KeyboardEvent): void => {
    handleSegmentKeydown(event, buttons, {
      length: TEXT_SIZES.length,
      getBaseIndex: current,
      onNavigate: select,
    });
  };
  const unsubscribe = textSizeSettings.subscribe(() => {
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
