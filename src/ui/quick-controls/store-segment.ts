import { handleSegmentKeydown } from "./seg-keyboard";

/** A radio segment bound to one store value: click and arrow keys set it, the store's changes reflect while the panel is open. */
export function createStoreSegment<T>(deps: {
  segment: HTMLElement;
  values: readonly T[];
  get: () => T;
  set: (value: T) => void;
  subscribe: (cb: () => void) => () => void;
  isOpen: () => boolean;
}) {
  const { segment, values, get, set, isOpen } = deps;
  const buttons = [...segment.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")];
  const current = (): number => values.indexOf(get());
  const reflect = (): void => {
    const index = current();
    buttons.forEach((button, i) => {
      button.setAttribute("aria-checked", String(i === index));
      button.tabIndex = i === index ? 0 : -1;
    });
  };
  const select = (index: number, focus = false): void => {
    const selected = Math.min(values.length - 1, Math.max(0, index));
    set(values[selected]);
    if (focus) buttons[selected].focus();
  };
  const click = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (!button) return;
    select(buttons.indexOf(button));
  };
  const keydown = (event: KeyboardEvent): void => {
    handleSegmentKeydown(event, buttons, {
      length: values.length,
      getBaseIndex: current,
      onNavigate: select,
    });
  };
  const unsubscribe = deps.subscribe(() => {
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
