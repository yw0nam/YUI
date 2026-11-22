/** The device-wide user name row: what typing commits, the blur that settles on the stored name, and the language's fallback placeholder. */

import { type FormEvent, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { PersonaConfig } from "../../../../config/validators/persona/types";
import type { createUserNameSettings } from "../../../../settings/identity/user-name-settings";
import { getLocale, subscribe as subscribeLocale, t } from "../../../i18n";

type UserNameSettingsStore = ReturnType<typeof createUserNameSettings>;

export function UserNameRow({
  store,
  getPersona,
}: {
  store: UserNameSettingsStore;
  getPersona?: () => PersonaConfig | undefined;
}) {
  const name = useSyncExternalStore(store.subscribe, () => store.current().name);
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  const inputRef = useRef<HTMLInputElement>(null);

  // The store trims, so a focused field keeps the raw text and takes the stored name on blur.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement !== input) input.value = name;
  }, [name]);

  function handleInput(event: FormEvent<HTMLInputElement>): void {
    store.setName(event.currentTarget.value);
  }

  function handleBlur(): void {
    const input = inputRef.current;
    if (input) input.value = store.current().name;
  }

  return (
    <div className="yui-row yui-input-row">
      <div className="yui-row__main">
        <label className="yui-input-row__label" htmlFor="yui-user-name">
          {t("card.user_name")}
        </label>
        <span className="yui-row__sub">{t("card.user_name_sub")}</span>
      </div>
      <div className="yui-input-wrap">
        <input
          className="yui-ep-input"
          id="yui-user-name"
          type="text"
          spellCheck={false}
          autoComplete="off"
          ref={inputRef}
          defaultValue={name}
          placeholder={getPersona?.()?.user_fallback[locale] ?? ""}
          onInput={handleInput}
          onBlur={handleBlur}
        />
      </div>
    </div>
  );
}
