// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCard } from "../../../../config/validators/persona/read-card";
import {
  type Card,
  EMPTY_CARD,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { createUserNameSettings } from "../../../../settings/identity/user-name-settings";
import { createPresetFromCard } from "../../../../settings/preset/import-card-preset";
import { createPresetRegistry } from "../../../../settings/preset/preset-registry";
import { createFillerSettings } from "../../../../settings/voice/filler-settings";
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
    history.replaceState(null, "", "/");
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  const visible = (sel: string) => !sec().querySelector<HTMLElement>(sel)!.hidden;
  const enabled = (sel: string) =>
    !sec().querySelector<HTMLInputElement | HTMLButtonElement>(sel)!.disabled;
  it("on push shows the body, disables the switch with its reason and every text field but the greetings", () => {
    agentSettings.updateCard({ alternate_greetings: ["hey"] }, persona.cards.en);
    agentSettings.setSendCard(false);
    build({ getDefaultChatApi: () => "push" });
    expect(visible(".yui-card-body")).toBe(true);
    expect(visible(".yui-group--switch")).toBe(true);
    expect(enabled(".yui-card-switch")).toBe(false);
    expect(visible(".yui-card .yui-push-reason")).toBe(true);
    expect(sec().querySelector(".yui-push-reason")!.textContent).toContain(
      "On push the backend's own profile is the persona; this card supplies only the greetings.",
    );
    expect(
      ["name", "description", "personality", "scenario", "mes_example", "system_prompt"].map((f) =>
        enabled(`[data-card-field="${f}"]`),
      ),
    ).toEqual([false, false, false, false, false, false]);
    expect(
      [
        '[data-card-field="first_mes"]',
        "[data-greeting-index]",
        ".yui-card-add",
        ".yui-card-import",
        ".yui-card-export",
      ].map(enabled),
    ).toEqual([true, true, true, true, true]);
  });

  it("keeps Reset to default on push with an own card", () => {
    agentSettings.updateCard({ description: "mine" }, persona.cards.en);
    build({ getDefaultChatApi: () => "push" });
    expect(visible(".yui-reset")).toBe(true);
  });

  it("follows a live transport change without reopening", () => {
    const endpointsSettings = createEndpointsSettings();
    endpointsSettings.set({ chat_api: "responses" });
    build({ endpointsSettings });
    expect([
      visible(".yui-card .yui-push-reason"),
      enabled('[data-card-field="description"]'),
    ]).toEqual([false, true]);
    endpointsSettings.set({ chat_api: "push" });
    expect([
      visible(".yui-card .yui-push-reason"),
      enabled('[data-card-field="description"]'),
    ]).toEqual([true, false]);
    endpointsSettings.set({ chat_api: "responses" });
    expect([
      visible(".yui-card .yui-push-reason"),
      enabled('[data-card-field="description"]'),
    ]).toEqual([false, true]);
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

  it("marks a refused preset name invalid and keeps what was typed", () => {
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
    const updateCard = vi.spyOn(agentSettings, "updateCard");
    build();
    type(field("name"), "default", "change");
    expect(field("name").getAttribute("aria-invalid")).toBe("true");
    expect(field("name").value).toBe("default");
    expect(updateCard).not.toHaveBeenCalled();
    type(field("name"), "mio", "change");
    expect(field("name").getAttribute("aria-invalid")).toBe("false");
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

  it("opens the cards guide from the ? button", () => {
    build();
    const help = sec().querySelector<HTMLAnchorElement>(".yui-card__help")!;
    expect(help.getAttribute("href")).toBe(CARD_GUIDE_URL);
    expect(help.target).toBe("_blank");
    expect(help.getAttribute("aria-label")).toBe("About cards");
  });

  it("exports the effective card as V2 JSON under the effective name", async () => {
    const exportCard = vi.fn(async (_text: string, _fileName: string) => "written" as const);
    build({ exportCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-export")!.click();
    await vi.waitFor(() => expect(exportCard).toHaveBeenCalledTimes(1));
    const [text, fileName] = exportCard.mock.calls[0];
    expect(fileName).toBe("Yui.json");
    expect(JSON.parse(text)).toMatchObject({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Yui", description: "English text" },
    });
  });

  it("export carries the preset's filler pools under extensions.yui.filler", async () => {
    const fillerSettings = createFillerSettings();
    fillerSettings.setCustomPool("ja", { first: ["A"] });
    const exportCard = vi.fn(async (_text: string, _fileName: string) => "written" as const);
    build({ fillerSettings, exportCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-export")!.click();
    await vi.waitFor(() => expect(exportCard).toHaveBeenCalledTimes(1));
    const [text] = exportCard.mock.calls[0];
    expect(JSON.parse(text).data.extensions.yui).toEqual({
      filler: { ja: { first: ["A"] } },
    });
  });

  it("an all-empty filler store omits extensions.yui.filler from the export", async () => {
    const exportCard = vi.fn(async (_text: string, _fileName: string) => "written" as const);
    build({ exportCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-export")!.click();
    await vi.waitFor(() => expect(exportCard).toHaveBeenCalledTimes(1));
    const [text] = exportCard.mock.calls[0];
    expect(JSON.parse(text).data.extensions.yui).toBeUndefined();
  });

  it("export keeps other extensions keys and an existing yui object beside the filler", async () => {
    agentSettings.setCard({
      ...EMPTY_CARD,
      name: "Yui",
      extensions: { other: { kept: 1 }, yui: { keep: "x" } },
    });
    const fillerSettings = createFillerSettings();
    fillerSettings.setCustomPool("ja", { first: ["A"] });
    const exportCard = vi.fn(async (_text: string, _fileName: string) => "written" as const);
    build({ fillerSettings, exportCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-export")!.click();
    await vi.waitFor(() => expect(exportCard).toHaveBeenCalledTimes(1));
    const [text] = exportCard.mock.calls[0];
    expect(JSON.parse(text).data.extensions).toEqual({
      other: { kept: 1 },
      yui: { keep: "x", filler: { ja: { first: ["A"] } } },
    });
  });

  it("exported filler pools import back into the new preset identically", async () => {
    const fillerSettings = createFillerSettings();
    fillerSettings.setCustomPool("ja", { first: ["A"] });
    let written = "";
    const exportCard = vi.fn(async (text: string, _fileName: string) => {
      written = text;
      return "written" as const;
    });
    build({ fillerSettings, exportCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-export")!.click();
    await vi.waitFor(() => expect(exportCard).toHaveBeenCalledTimes(1));

    const storage = (() => {
      const map = new Map<string, string>();
      return {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => void map.set(key, value),
        removeItem: (key: string) => void map.delete(key),
        clear: () => map.clear(),
        key: () => null,
        get length() {
          return map.size;
        },
      } as Storage;
    })();
    // The copied filler value registry.create seeds the new preset with before the import runs.
    storage.setItem(
      "yui.n1.filler",
      JSON.stringify({ enabled: true, language: "en", customPools: { en: { first: ["hi"] } } }),
    );
    await createPresetFromCard({
      registry: {
        create: () => "n1",
        setThumbnail: () => true,
        activate: () => true,
        remove: () => true,
      },
      card: readCard(JSON.parse(written)).card,
      storage,
      fillerLocale: "ja",
    });
    expect(JSON.parse(storage.getItem("yui.n1.filler")!).customPools).toEqual(
      JSON.parse(written).data.extensions.yui.filler,
    );
  });

  it("an export cancelled at the save dialog logs nothing", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const exportCard = vi.fn(async () => "cancelled" as const);
    build({ exportCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-export")!.click();
    await vi.waitFor(() => expect(exportCard).toHaveBeenCalledTimes(1));
    expect(info.mock.calls.some((c) => String(c[0]).includes("card_export"))).toBe(false);
  });

  it("import success creates the preset from the card and logs card_import once", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const importedCard = { ...EMPTY_CARD, name: "Mio", first_mes: "Hi." };
    const importCard = vi.fn(async () => ({ card: importedCard, thumbnailTempId: "temp-1" }));
    const createPresetFromCard = vi.fn(async () => "abcd1234");
    build({ importCard, createPresetFromCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-import")!.click();
    await vi.waitFor(() => expect(createPresetFromCard).toHaveBeenCalledTimes(1));
    expect(createPresetFromCard).toHaveBeenCalledWith(importedCard, "temp-1");
    expect(info.mock.calls.filter((c) => String(c[0]).includes("card_import"))).toHaveLength(1);
  });

  it("a refused preset creation shows the generic import failure and logs no success", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const importCard = vi.fn(async () => ({ card: { ...EMPTY_CARD, name: "Mio" } }));
    const createPresetFromCard = vi.fn(async () => {
      throw new Error("preset_create_failed");
    });
    build({ importCard, createPresetFromCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-import")!.click();
    await vi.waitFor(() =>
      expect(sec().querySelector<HTMLElement>(".yui-card__io-error")!.textContent).toBe(
        "Could not import that card",
      ),
    );
    expect(info.mock.calls.some((c) => String(c[0]).includes("card_import"))).toBe(false);
  });

  it("an unreadable payload shows the holds-no-card error", async () => {
    const importCard = vi.fn(async () => {
      throw new Error("card_unreadable");
    });
    build({ importCard });
    sec().querySelector<HTMLButtonElement>(".yui-card-import")!.click();
    await vi.waitFor(() =>
      expect(sec().querySelector<HTMLElement>(".yui-card__io-error")!.textContent).toBe(
        "That file holds no card",
      ),
    );
  });

  it("keeps the action row visible with the send switch off", () => {
    build();
    sec().querySelector<HTMLButtonElement>(".yui-card-switch")!.click();
    const body = sec().querySelector<HTMLElement>(".yui-card-body")!;
    const importBtn = sec().querySelector<HTMLButtonElement>(".yui-card-import")!;
    expect(body.hidden).toBe(true);
    expect(body.contains(importBtn)).toBe(false);
    expect(importBtn.hidden).toBe(false);
  });

  it("shows the thumbnail img only for an entry that carries one", () => {
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({
        active: "default",
        list: [
          { id: "default", name: "default" },
          {
            id: "aaaa0001",
            name: "natsume",
            thumbnail: "asset://localhost/app-data/cards/aaaa0001.png",
          },
        ],
      }),
    );
    registry = createPresetRegistry();
    build();
    expect(sec().querySelector<HTMLImageElement>(".yui-card-thumb")!.hidden).toBe(true);
    history.replaceState(null, "", "/?preset=aaaa0001");
    qc.dispose();
    build();
    const thumb = sec().querySelector<HTMLImageElement>(".yui-card-thumb")!;
    expect(thumb.hidden).toBe(false);
    expect(thumb.src).toBe("asset://localhost/app-data/cards/aaaa0001.png");
  });
});
