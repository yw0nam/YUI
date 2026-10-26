// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { EMPTY_CARD, type PersonaConfig } from "../../../../config/validators/persona/types";
import { createUserNameSettings } from "../../../../settings/identity/user-name-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

const persona: PersonaConfig = {
  framing: { en: "f", ja: "f", ko: "f" },
  user_fallback: { en: "User", ja: "ユーザー", ko: "사용자" },
  cards: { en: EMPTY_CARD, ja: EMPTY_CARD, ko: EMPTY_CARD },
};

beforeEach(() => setLocale("en"));
afterEach(() => {
  document.body.innerHTML = "";
});

it("edits Your name on the General page, shows the fallback word, and follows the store", () => {
  const mount = document.body.appendChild(document.createElement("div"));
  const userNameSettings = createUserNameSettings({ storage: undefined });
  const qc = createQuickControls({
    ...defaultQcArgs(mount),
    userNameSettings,
    getPersona: () => persona,
  });
  qc.open();

  const input = qc.el.querySelector<HTMLInputElement>("#yui-panel-general #yui-user-name")!;
  expect(input.placeholder).toBe("User");
  input.value = "Ren";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(userNameSettings.get().name).toBe("Ren");

  userNameSettings.setName("Aki");
  expect(input.value).toBe("Aki");
  qc.dispose();
});
