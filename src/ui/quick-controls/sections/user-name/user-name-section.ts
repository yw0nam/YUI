/** "Your name": the device-wide name `{{user}}` stands for, with the language's fallback word as placeholder. */

import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { createUserNameSettings } from "../../../../settings/identity/user-name-settings";
import { getLocale, subscribe as subscribeLocale, t } from "../../../i18n";

export function userNameRowHtml(): string {
  return `
            <div class="yui-row yui-input-row">
              <div class="yui-row__main"><label class="yui-input-row__label" for="yui-user-name">${t("card.user_name")}</label><span class="yui-row__sub">${t("card.user_name_sub")}</span></div>
              <div class="yui-input-wrap"><input class="yui-ep-input" id="yui-user-name" type="text" spellcheck="false" autocomplete="off" /></div>
            </div>`;
}

export function createUserNameSection(deps: {
  root: HTMLElement;
  userNameSettings: ReturnType<typeof createUserNameSettings>;
  getPersona?: () => PersonaConfig | undefined;
  /** The store subscription redraws only while the panel is open. */
  isOpen: () => boolean;
}): { reflect(): void; dispose(): void } {
  const { userNameSettings, getPersona, isOpen } = deps;
  const input = deps.root.querySelector<HTMLInputElement>("#yui-user-name")!;

  // A focused field keeps what the user is typing; it catches up on blur.
  function reflect(): void {
    const name = userNameSettings.get().name;
    if (!(document.hasFocus() && document.activeElement === input) && input.value !== name)
      input.value = name;
    input.placeholder = getPersona?.()?.user_fallback[getLocale()] ?? "";
  }
  function handleInput(): void {
    userNameSettings.setName(input.value);
  }
  const redraw = (): void => {
    if (isOpen()) reflect();
  };
  const unsubscribes = [userNameSettings.subscribe(redraw), subscribeLocale(redraw)];
  input.addEventListener("input", handleInput);
  input.addEventListener("blur", reflect);

  return {
    reflect,
    dispose(): void {
      for (const off of unsubscribes) off();
      input.removeEventListener("input", handleInput);
      input.removeEventListener("blur", reflect);
    },
  };
}
