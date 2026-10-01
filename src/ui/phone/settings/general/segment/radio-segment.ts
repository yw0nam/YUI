/**
 * The General tab's radio segment: the buttons of one `.yui-seg` as a roving-focus radiogroup.
 * Arrows, Home and End move the focus past disabled buttons; Space, Enter and a click commit the
 * button; the owner decides which button is selected and reflects it.
 */

import { handleSegmentKeydown } from "../../../../quick-controls/seg-keyboard";

export interface RadioSegment {
  buttons: HTMLButtonElement[];
  /** Mark one button selected and give it the tab stop. */
  reflect(selectedIndex: number): void;
  dispose(): void;
}

export function bindRadioSegment(deps: {
  seg: HTMLElement;
  /** A button was committed by click or key; never called for a disabled one. */
  onCommit: (index: number) => void;
}): RadioSegment {
  const { seg, onCommit } = deps;
  const buttons = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));

  function reflect(selectedIndex: number): void {
    buttons.forEach((btn, i) => {
      btn.setAttribute("aria-checked", String(i === selectedIndex));
      btn.tabIndex = i === selectedIndex ? 0 : -1;
    });
  }

  function moveFocus(index: number): void {
    const btn = buttons[Math.min(buttons.length - 1, Math.max(0, index))];
    if (!btn || btn.disabled) return;
    for (const b of buttons) b.tabIndex = -1;
    btn.tabIndex = 0;
    btn.focus();
  }

  function commit(index: number): void {
    const btn = buttons[index];
    if (!btn || btn.disabled) return;
    onCommit(index);
    btn.focus();
  }

  function handleClick(e: MouseEvent): void {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".yui-seg__btn");
    if (btn) commit(buttons.indexOf(btn));
  }

  function handleKeydown(e: KeyboardEvent): void {
    handleSegmentKeydown(e, buttons, {
      length: buttons.length,
      getBaseIndex: () => {
        const focused = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const checked = buttons.findIndex((b) => b.getAttribute("aria-checked") === "true");
        return focused >= 0 ? focused : Math.max(0, checked);
      },
      onNavigate: moveFocus,
      onCommit: commit,
    });
  }

  seg.addEventListener("click", handleClick);
  seg.addEventListener("keydown", handleKeydown);

  return {
    buttons,
    reflect,
    dispose(): void {
      seg.removeEventListener("click", handleClick);
      seg.removeEventListener("keydown", handleKeydown);
    },
  };
}
