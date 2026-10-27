/** The quick card's rows: the Body and Reference voice selects, the reset that asks first, and Turn off. */

import type { Logger } from "../../logger";
import { t } from "../i18n";

/** A native select's options and the store it applies to at once. */
export interface PickerPort {
  options(): { id: string; label: string }[];
  current(): string;
  select(id: string): Promise<void>;
  subscribe(cb: () => void): () => void;
}

export function createRows(deps: {
  body: PickerPort;
  voice: PickerPort;
  resetConversation(): void;
  /** Null for main, which cannot be turned off. */
  turnOff: (() => void) | null;
  log: Logger;
}): { el: HTMLElement; paint(): void; disarm(): void; dispose(): void } {
  const { log } = deps;
  const el = document.createElement("div");
  el.className = "yui-qcard__rows";
  el.innerHTML = `
    <label class="yui-qcard__row"><span>${t("quick_card.body")}</span><select class="yui-qcard__select"></select></label>
    <label class="yui-qcard__row"><span>${t("quick_card.voice_ref")}</span><select class="yui-qcard__select"></select></label>
    <div class="yui-qcard__row"><span>${t("quick_card.conversation")}</span><button class="yui-qcard__reset" type="button">${t("quick_card.reset")}</button></div>
    <div class="yui-qcard__confirm" hidden>
      <span class="yui-qcard__confirm-q">${t("quick_card.reset_confirm")}</span>
      <button class="yui-qcard__pill yui-qcard__cancel" type="button">${t("quick_card.cancel")}</button>
      <button class="yui-qcard__pill yui-qcard__confirm-go" type="button">${t("quick_card.reset_go")}</button>
    </div>
    ${deps.turnOff ? `<button class="yui-qcard__row yui-qcard__turnoff" type="button">${t("quick_card.turn_off")}</button>` : ""}`;
  const q = <T extends Element>(selector: string): T => el.querySelector<T>(selector)!;
  const [bodySelect, voiceSelect] = el.querySelectorAll<HTMLSelectElement>(".yui-qcard__select");
  const resetBtn = q<HTMLButtonElement>(".yui-qcard__reset");
  const confirmEl = q<HTMLElement>(".yui-qcard__confirm");

  const pickers = [
    { select: bodySelect!, port: deps.body },
    { select: voiceSelect!, port: deps.voice },
  ];
  function paintPicker({ select, port }: (typeof pickers)[number]): void {
    const current = port.current();
    const options = port.options();
    // No voice set: the empty id reads None instead of a blank select.
    select.replaceChildren(
      ...(options.length > 0 ? options : [{ id: "", label: "" }]).map(
        (o) =>
          new Option(
            o.id === "" ? t("quick_card.voice_none") : o.label,
            o.id,
            false,
            o.id === current,
          ),
      ),
    );
  }
  for (const picker of pickers) {
    picker.select.addEventListener("change", () => {
      void picker.port
        .select(picker.select.value)
        .catch((err) => log.warn("select_failed", { error: String(err) }))
        .finally(() => paintPicker(picker));
    });
  }

  // Focus follows the button that stays visible, so Escape still reaches the card.
  function showConfirm(show: boolean): void {
    confirmEl.hidden = !show;
    resetBtn.hidden = show;
    (show ? q<HTMLButtonElement>(".yui-qcard__cancel") : resetBtn).focus();
  }
  resetBtn.addEventListener("click", () => showConfirm(true));
  q(".yui-qcard__cancel").addEventListener("click", () => showConfirm(false));
  q(".yui-qcard__confirm-go").addEventListener("click", () => {
    deps.resetConversation();
    showConfirm(false);
  });
  el.querySelector(".yui-qcard__turnoff")?.addEventListener("click", () => deps.turnOff?.());

  const unsubscribes = pickers.map((picker) => picker.port.subscribe(() => paintPicker(picker)));

  return {
    el,
    paint: () => {
      for (const picker of pickers) paintPicker(picker);
    },
    // A reopen never lands on the destructive button.
    disarm: () => {
      confirmEl.hidden = true;
      resetBtn.hidden = false;
    },
    dispose: () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    },
  };
}
