/** The Threads window head's Thread turns button: it opens a popover of the three levels. */

import "./turns-menu.css";
import {
  THREAD_TURNS,
  type ThreadTurnsLevel,
} from "../../../settings/threads/thread-turns-settings";
import { subscribe as subscribeLocale, t } from "../../i18n";
import { handleSegmentKeydown } from "../../quick-controls/seg-keyboard";

const BELL_SVG =
  '<svg class="yui-threads-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>';

export interface TurnsState {
  level: ThreadTurnsLevel;
  /** External signals is off, so no Thread reaches the main window. */
  disabled: boolean;
}

export interface TurnsMenu {
  el: HTMLElement;
  set(state: TurnsState): void;
  isOpen(): boolean;
  close(): void;
  dispose(): void;
}

export function createTurnsMenu(deps: { onPick(level: ThreadTurnsLevel): void }): TurnsMenu {
  const el = document.createElement("div");
  el.className = "yui-threads__turns";
  el.innerHTML = `
    <button type="button" class="yui-threads__turns-button" aria-haspopup="true" aria-expanded="false">${BELL_SVG}<span class="yui-threads__turns-label"></span></button>
    <div class="yui-threads__turns-pop" role="radiogroup" aria-labelledby="yui-threads-turns-caption" hidden>
      <p class="yui-threads__turns-caption" id="yui-threads-turns-caption"></p>
      ${THREAD_TURNS.map(
        (level) => `
        <button type="button" class="yui-threads__turns-radio" role="radio" data-level="${level}">
          <span class="yui-threads__turns-tick" aria-hidden="true"></span>
          <span class="yui-threads__turns-text"><span></span><span></span></span>
        </button>`,
      ).join("")}
      <p class="yui-threads__turns-note"></p>
    </div>`;
  const button = el.querySelector<HTMLButtonElement>(".yui-threads__turns-button")!;
  const label = el.querySelector<HTMLElement>(".yui-threads__turns-label")!;
  const pop = el.querySelector<HTMLElement>(".yui-threads__turns-pop")!;
  const caption = el.querySelector<HTMLElement>(".yui-threads__turns-caption")!;
  const note = el.querySelector<HTMLElement>(".yui-threads__turns-note")!;
  const radios = [...el.querySelectorAll<HTMLButtonElement>(".yui-threads__turns-radio")];
  let state: TurnsState = { level: "off", disabled: false };

  function render(): void {
    const checked = THREAD_TURNS.indexOf(state.level);
    label.textContent = t("threads.turns_button", { level: t(`threadTurns.${state.level}`) });
    button.classList.toggle("is-on", state.level !== "off");
    caption.textContent = t("threads.turns_caption");
    radios.forEach((radio, i) => {
      const level = THREAD_TURNS[i]!;
      const [name, sub] = radio.querySelectorAll<HTMLElement>(".yui-threads__turns-text > span");
      name!.textContent = t(`threadTurns.${level}`);
      sub!.textContent = t(`threads.turns_${level}_sub`);
      radio.setAttribute("aria-checked", String(i === checked));
      radio.tabIndex = i === checked ? 0 : -1;
      radio.disabled = state.disabled;
    });
    note.textContent = t(state.disabled ? "threadTurns.disabled_reason" : "threads.turns_note");
  }

  function open(): void {
    pop.hidden = false;
    button.setAttribute("aria-expanded", "true");
    radios[THREAD_TURNS.indexOf(state.level)]!.focus();
    document.addEventListener("pointerdown", onOutsidePointer, true);
  }

  function close(): void {
    if (pop.hidden) return;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
    pop.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.focus();
  }

  function onOutsidePointer(e: PointerEvent): void {
    if (!el.contains(e.target as Node)) close();
  }

  function focusRadio(index: number): void {
    const next = radios[Math.max(0, Math.min(radios.length - 1, index))]!;
    for (const radio of radios) radio.tabIndex = radio === next ? 0 : -1;
    next.focus();
  }

  button.addEventListener("click", () => (pop.hidden ? open() : close()));
  radios.forEach((radio, i) => {
    radio.addEventListener("click", () => {
      deps.onPick(THREAD_TURNS[i]!);
      close();
    });
  });
  pop.addEventListener("keydown", (e) =>
    handleSegmentKeydown(e, radios, {
      length: radios.length,
      getBaseIndex: () => radios.indexOf(document.activeElement as HTMLButtonElement),
      onNavigate: focusRadio,
    }),
  );
  // A press inside the popover is not the head's window drag.
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());
  const offLocale = subscribeLocale(render);
  render();

  return {
    el,
    set(next) {
      state = next;
      render();
    },
    isOpen: () => !pop.hidden,
    close,
    dispose() {
      document.removeEventListener("pointerdown", onOutsidePointer, true);
      offLocale();
      el.remove();
    },
  };
}
