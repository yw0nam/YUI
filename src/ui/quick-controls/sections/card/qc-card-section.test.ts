// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Card,
  EMPTY_CARD,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { createUserNameSettings } from "../../../../settings/identity/user-name-settings";
import { createPresetRegistry } from "../../../../settings/preset/preset-registry";
import { setLocale } from "../../../i18n";
import { CARD_GUIDE_URL } from "../../constants";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs, inMemoryAgentStorage } from "../../test-helpers";

const card = (description: string): Card => ({ ...EMPTY_CARD, name: "Yui", description });
const persona: PersonaConfig = {
  framing: { en: "f", ja: "f", ko: "f" },
  user_fallback: { en: "User", ja: "ユーザー", ko: "사용자" },
  cards: { en: card("English text"), ja: card("日本語のテキスト"), ko: card("한국어 텍스트") },
};

describe("createQuickControls — card section", () => {
  let mount: HTMLElement;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let userNameSettings: ReturnType<typeof createUserNameSettings>;
  let registry: ReturnType<typeof createPresetRegistry>;
  let qc: ReturnType<typeof createQuickControls>;

  const sec = () => qc.el.querySelector<HTMLElement>(".yui-card")!;
  const field = (name: string) =>
    sec().querySelector<HTMLInputElement & HTMLTextAreaElement>(`[data-card-field="${name}"]`)!;
  const type = (el: HTMLInputElement | HTMLTextAreaElement, value: string, event = "input") => {
    el.value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  };
  const build = (extra?: Partial<Parameters<typeof createQuickControls>[0]>) => {
    qc = createQuickControls({
      ...defaultQcArgs(mount),
      agentSettings,
      userNameSettings,
      presetRegistry: registry,
      getPersona: () => persona,
      ...extra,
    });
    qc.open();
  };

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    localStorage.clear();
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    userNameSettings = createUserNameSettings({ storage: undefined });
    registry = createPresetRegistry();
  });

  afterEach(() => {
    qc.dispose();
    registry.dispose();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("hides the whole section on the push transport", () => {
    build({ getDefaultChatApi: () => "push" });
    expect(sec().hidden).toBe(true);
  });

  it("shows the default card of the UI language and the state hint", () => {
    build();
    expect(field("description").value).toBe("English text");
    expect(sec().querySelector<HTMLElement>(".yui-sec__state")!.hidden).toBe(false);
    expect(sec().querySelector<HTMLElement>(".yui-reset")!.hidden).toBe(true);
  });

  it("collapses the body and the aside while the switch is off", () => {
    build();
    sec().querySelector<HTMLButtonElement>(".yui-card-switch")!.click();
    expect(agentSettings.get().send_card).toBe(false);
    expect(sec().querySelector<HTMLElement>(".yui-card-body")!.hidden).toBe(true);
    expect(sec().querySelector<HTMLElement>(".yui-sec__state")!.hidden).toBe(true);
    expect(sec().querySelector<HTMLElement>(".yui-reset")!.hidden).toBe(true);
  });

  it("writes an edit with the resolved default card as base", () => {
    const updateCard = vi.spyOn(agentSettings, "updateCard");
    build();
    type(field("description"), "mine");
    expect(updateCard).toHaveBeenCalledWith({ description: "mine" }, persona.cards.en);
  });

  it("Reset to default clears an own card", () => {
    agentSettings.setCard(card("own"));
    const resetCard = vi.spyOn(agentSettings, "resetCard");
    build();
    const reset = sec().querySelector<HTMLButtonElement>(".yui-reset")!;
    expect(reset.hidden).toBe(false);
    reset.click();
    expect(resetCard).toHaveBeenCalled();
    expect(field("description").value).toBe("English text");
  });

  it("renames a non-built-in preset through the registry", () => {
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({
        active: "aaaa0001",
        list: [
          { id: "default", name: "default" },
          { id: "aaaa0001", name: "natsume" },
        ],
      }),
    );
    const rename = vi.spyOn(registry, "rename");
    const updateCard = vi.spyOn(agentSettings, "updateCard");
    build();
    expect(field("name").value).toBe("natsume");
    type(field("name"), "mio", "change");
    expect(rename).toHaveBeenCalledWith("aaaa0001", "mio");
    expect(updateCard).not.toHaveBeenCalled();
  });

  it("writes the card name for the unnamed built-in preset", () => {
    const rename = vi.spyOn(registry, "rename");
    const updateCard = vi.spyOn(agentSettings, "updateCard");
    build();
    expect(field("name").value).toBe("Yui");
    type(field("name"), "Mio", "change");
    expect(updateCard).toHaveBeenCalledWith({ name: "Mio" }, persona.cards.en);
    expect(rename).not.toHaveBeenCalled();
  });

  it("adds and removes a greeting", () => {
    build();
    sec().querySelector<HTMLButtonElement>(".yui-card-add")!.click();
    expect(agentSettings.get().card?.alternate_greetings).toEqual([""]);
    const ta = sec().querySelector<HTMLTextAreaElement>(".yui-card-greeting textarea")!;
    type(ta, "Hello again");
    expect(agentSettings.get().card?.alternate_greetings).toEqual(["Hello again"]);
    sec().querySelector<HTMLButtonElement>(".yui-card-greeting__remove")!.click();
    expect(agentSettings.get().card?.alternate_greetings).toEqual([]);
    expect(sec().querySelectorAll(".yui-card-greeting")).toHaveLength(0);
  });

  it("redraws a default card on a UI-language change and leaves an own card", () => {
    build();
    setLocale("ja");
    expect(field("description").value).toBe("日本語のテキスト");
    agentSettings.setCard(card("own"));
    setLocale("ko");
    expect(field("description").value).toBe("own");
  });

  it("does not overwrite a focused field when the store changes", () => {
    build();
    const ta = field("description");
    ta.focus();
    ta.value = "mid-edit";
    agentSettings.setCard(card("remote"));
    expect(ta.value).toBe("mid-edit");
    ta.blur();
    expect(ta.value).toBe("remote");
  });

  it("stores the user's name and shows the language's fallback word as placeholder", () => {
    build();
    const input = sec().querySelector<HTMLInputElement>(".yui-card-username")!;
    expect(input.placeholder).toBe("User");
    type(input, "Ren");
    expect(userNameSettings.get().name).toBe("Ren");
  });

  it("opens the cards guide from the ? button", () => {
    build();
    const help = sec().querySelector<HTMLAnchorElement>(".yui-card__help")!;
    expect(help.getAttribute("href")).toBe(CARD_GUIDE_URL);
    expect(help.target).toBe("_blank");
    expect(help.getAttribute("aria-label")).toBe("About cards");
  });
});
