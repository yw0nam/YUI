// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCard } from "../../../../config/validators/persona/read-card";
import {
  type Card,
  EMPTY_CARD,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import type { PresetExportRequest } from "../../../../io/assets/preset-file/preset-file-export";
import { createVrmSelection } from "../../../../io/assets/vrm-selection";
import { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
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
    sessionStorage.clear();
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
  const ioButton = (label: string): HTMLButtonElement => {
    const btn = [...sec().querySelectorAll<HTMLButtonElement>(".yui-card__io button")].find(
      (b) => b.textContent === label,
    );
    expect(btn?.textContent).toBe(label);
    return btn!;
  };
  const panel = () => sec().querySelector<HTMLElement>(".yui-preset-export");
  const panelButton = (label: string): HTMLButtonElement => {
    const btn = [...(panel()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (b) => b.textContent === label,
    );
    expect(btn?.textContent).toBe(label);
    return btn!;
  };
  const rightsSwitch = () => panel()!.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
  /** Each listed row as [label, status, sub]. */
  const panelRows = (): string[][] =>
    [...(panel()?.querySelectorAll<HTMLElement>(".yui-preset-export__item") ?? [])].map((row) => [
      row.querySelector(".yui-row__label")?.textContent ?? "",
      row.querySelector(".yui-preset-export__status")?.textContent ?? "",
      row.querySelector(".yui-row__sub")?.textContent ?? "",
    ]);
  const doneLine = () => sec().querySelector<HTMLElement>(".yui-card__io-done")?.textContent;
  /** Opens the panel, turns the rights switch on and presses Export…; returns the request. */
  const exportPreset = async (
    exportPresetFile: ReturnType<typeof vi.fn<(r: PresetExportRequest) => unknown>>,
  ): Promise<PresetExportRequest> => {
    ioButton("Export preset (.yui)").click();
    rightsSwitch().click();
    panelButton("Export…").click();
    await vi.waitFor(() => expect(exportPresetFile).toHaveBeenCalledTimes(1));
    return exportPresetFile.mock.calls[0][0];
  };
  /** The window shows a non-built-in preset that carries a picture and its crop. */
  const pictured = () => {
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({
        active: "aaaa0001",
        list: [
          { id: "default", name: "default" },
          {
            id: "aaaa0001",
            name: "natsume",
            thumbnail: "asset://localhost/app-data/cards/aaaa0001.png",
            crop: { x: 0.1, y: 0.2, size: 0.5 },
          },
        ],
      }),
    );
  };
  const userVrm = () => {
    const s = createVrmSelection({
      available: [
        { id: "carlotta", label: "Carlotta", url: "/vrms/carlotta.vrm", source: "bundled" },
      ],
      defaultValue: "/vrms/carlotta.vrm",
    });
    s.addUserOption({
      id: "mine",
      label: "Mine",
      url: "asset://localhost/mine.vrm",
      source: "user",
    });
    s.select("mine");
    return s;
  };
  const userVoice = () => {
    const s = createSpeakerSelection({
      available: [{ id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" }],
      defaultValue: "natsume",
    });
    s.addUserOption({
      id: "myvoice",
      label: "My voice",
      ref_url: "asset://localhost/references/myvoice/clip.wav",
      source: "user",
    });
    s.select("myvoice");
    return s;
  };

  it("on push shows the body, disables the switch with its reason and every card field, keeps the name and the file buttons", () => {
    agentSettings.updateCard({ alternate_greetings: ["hey"] }, persona.cards.en);
    agentSettings.setSendCard(false);
    build({ getDefaultChatApi: () => "push" });
    expect(visible(".yui-card-body")).toBe(true);
    expect(visible(".yui-group--switch")).toBe(true);
    expect(enabled(".yui-card-switch")).toBe(false);
    expect(visible(".yui-card .yui-push-reason")).toBe(true);
    expect(sec().querySelector(".yui-push-reason")!.textContent).toContain(
      "On push the backend uses its own persona; this card, greetings included, is not used.",
    );
    expect(
      [
        "description",
        "personality",
        "scenario",
        "first_mes",
        "mes_example",
        "system_prompt",
        "post_history_instructions",
      ].map((f) => enabled(`[data-card-field="${f}"]`)),
    ).toEqual([false, false, false, false, false, false, false]);
    expect(
      ["[data-greeting-index]", ".yui-card-greeting__remove", ".yui-card-add"].map(enabled),
    ).toEqual([false, false, false]);
    expect(
      ['[data-card-field="name"]', ".yui-card-import", ".yui-card-export-preset"].map(enabled),
    ).toEqual([true, true, true]);
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

  it("the preset file carries the effective card as V2 JSON under the effective name", async () => {
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({ exportPresetFile });
    const request = await exportPreset(exportPresetFile);
    expect(request.defaultName).toBe("Yui.yui");
    expect(JSON.parse(request.cardJson)).toMatchObject({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Yui", description: "English text" },
    });
  });

  it("export carries the preset's filler pools under extensions.yui.filler", async () => {
    const fillerSettings = createFillerSettings();
    fillerSettings.setCustomPool("ja", { first: ["A"] });
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({ fillerSettings, exportPresetFile });
    const { cardJson } = await exportPreset(exportPresetFile);
    expect(JSON.parse(cardJson).data.extensions.yui).toEqual({
      filler: { ja: { first: ["A"] } },
    });
  });

  it("an all-empty filler store omits extensions.yui.filler from the export", async () => {
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({ exportPresetFile });
    const { cardJson } = await exportPreset(exportPresetFile);
    expect(JSON.parse(cardJson).data.extensions.yui).toBeUndefined();
  });

  it("export keeps other extensions keys and an existing yui object beside the filler", async () => {
    agentSettings.setCard({
      ...EMPTY_CARD,
      name: "Yui",
      extensions: { other: { kept: 1 }, yui: { keep: "x" } },
    });
    const fillerSettings = createFillerSettings();
    fillerSettings.setCustomPool("ja", { first: ["A"] });
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({ fillerSettings, exportPresetFile });
    const { cardJson } = await exportPreset(exportPresetFile);
    expect(JSON.parse(cardJson).data.extensions).toEqual({
      other: { kept: 1 },
      yui: { keep: "x", filler: { ja: { first: ["A"] } } },
    });
  });

  it("exported filler pools import back into the new preset identically", async () => {
    const fillerSettings = createFillerSettings();
    fillerSettings.setCustomPool("ja", { first: ["A"] });
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({ fillerSettings, exportPresetFile });
    const written = (await exportPreset(exportPresetFile)).cardJson;

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

  it("an export cancelled at the save dialog logs nothing and shows no saved line", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({ exportPresetFile });
    await exportPreset(exportPresetFile);
    expect(info.mock.calls.some((c) => String(c[0]).includes("card_export"))).toBe(false);
    expect(sec().querySelector<HTMLElement>(".yui-card__io-done")?.hidden).toBe(true);
  });

  it("the action row holds Import…, Export preset (.yui) and Export card only (PNG)", () => {
    build();
    expect(
      [...sec().querySelectorAll<HTMLButtonElement>(".yui-card__io button")].map(
        (b) => b.textContent,
      ),
    ).toEqual(["Import…", "Export preset (.yui)", "Export card only (PNG)"]);
  });

  it("Export card only (PNG) is disabled without a picture, with the reason in the note line", () => {
    build();
    expect(ioButton("Export card only (PNG)").disabled).toBe(true);
    expect(sec().querySelector(".yui-card__io-note")!.textContent).toBe(
      "Preset file (.yui), JSON or PNG card in · preset file or PNG card out. PNG export needs a picture, and this preset has none",
    );
  });

  it("Export card only (PNG) writes the card into the preset's picture at once", async () => {
    pictured();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const exportCardPng = vi.fn(async (_n: string, _j: string, _id: string) => "written" as const);
    build({ exportCardPng });
    expect(sec().querySelector(".yui-card__io-note")!.textContent).toBe(
      "Preset file (.yui), JSON or PNG card in · preset file or PNG card out",
    );
    ioButton("Export card only (PNG)").click();
    await vi.waitFor(() => expect(exportCardPng).toHaveBeenCalledTimes(1));
    const [name, json, presetId] = exportCardPng.mock.calls[0];
    expect([name, presetId, JSON.parse(json).data.name]).toEqual([
      "natsume.png",
      "aaaa0001",
      "natsume",
    ]);
    await vi.waitFor(() => expect(doneLine()).toBe("Saved"));
    expect(info.mock.calls.filter((c) => String(c[0]).includes("card_export"))).toHaveLength(1);
  });

  it.each([
    ["allowed", ["VRM", "Included", "Mine"]],
    ["prohibited", ["VRM", "Left out", "This VRM does not allow redistribution"]],
    [
      "unknown",
      ["VRM", "Check needed", "No license info. It goes in only if you have the right to share it"],
    ],
  ] as const)("the panel's VRM row for a user VRM whose license is %s", async (license, row) => {
    const inspectPresetVrm = vi.fn(async (_id: string) => ({ license, bytes: 9 }));
    build({ vrmSelection: userVrm(), inspectPresetVrm });
    ioButton("Export preset (.yui)").click();
    await vi.waitFor(() => expect(panelRows()[1]).toEqual(row));
    expect(inspectPresetVrm).toHaveBeenCalledWith("mine");
  });

  it("the panel names a bundled VRM as built in without reading its license", async () => {
    const inspectPresetVrm = vi.fn(async (_id: string) => ({
      license: "allowed" as const,
      bytes: 1,
    }));
    build({ inspectPresetVrm });
    ioButton("Export preset (.yui)").click();
    await vi.waitFor(() =>
      expect(panelRows()).toEqual([
        ["Card", "Included", "Yui"],
        ["VRM", "Included (built in)", "Carlotta"],
        ["Voice", "Left out", "This voice has no local clip"],
      ]),
    );
    expect(inspectPresetVrm).not.toHaveBeenCalled();
  });

  it("the panel lists the thumbnail when the preset has a picture, and a user voice clip as included", async () => {
    pictured();
    build({ speakerSelection: userVoice() });
    ioButton("Export preset (.yui)").click();
    await vi.waitFor(() =>
      expect(panelRows()).toEqual([
        ["Card", "Included", "natsume"],
        ["Thumbnail", "Included", ""],
        ["VRM", "Included (built in)", "Carlotta"],
        ["Voice", "Included", "The receiver registers it with their own TTS"],
      ]),
    );
  });

  it("Export… stays disabled until the rights switch is on, then sends the card, picture, VRM and voice", async () => {
    pictured();
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => "cancelled" as const);
    build({
      vrmSelection: userVrm(),
      speakerSelection: userVoice(),
      inspectPresetVrm: vi.fn(async () => ({ license: "allowed" as const, bytes: 9 })),
      exportPresetFile,
    });
    ioButton("Export preset (.yui)").click();
    const go = panelButton("Export…");
    expect(go.disabled).toBe(true);
    rightsSwitch().click();
    expect([rightsSwitch().getAttribute("aria-checked"), go.disabled]).toEqual(["true", false]);
    go.click();
    await vi.waitFor(() => expect(exportPresetFile).toHaveBeenCalledTimes(1));
    const { cardJson, ...rest } = exportPresetFile.mock.calls[0][0];
    expect(rest).toEqual({
      defaultName: "natsume.yui",
      thumbnailPresetId: "aaaa0001",
      crop: { x: 0.1, y: 0.2, size: 0.5 },
      vrm: { kind: "user", id: "mine" },
      voice: { id: "myvoice", label: "My voice" },
    });
  });

  it.each([
    [true, "Saved"],
    [false, "Saved · VRM left out"],
  ])("a saved preset file with vrmIncluded %s closes the panel and shows %s", async (vrmIncluded, line) => {
    const exportPresetFile = vi.fn(async (_r: PresetExportRequest) => ({ vrmIncluded, bytes: 5 }));
    build({ exportPresetFile });
    await exportPreset(exportPresetFile);
    await vi.waitFor(() => expect(doneLine()).toBe(line));
    expect(sec().querySelector<HTMLElement>(".yui-preset-export")!.hidden).toBe(true);
  });

  it("shows the voice notice after the import reload and removes the one-shot key", () => {
    sessionStorage.setItem("yui.card-import-notice", "voice");
    build();
    const notice = sec().querySelector<HTMLElement>(".yui-card__io-notice");
    expect([notice?.hidden, notice?.textContent]).toEqual([
      false,
      "The voice could not be registered with your TTS, so the new preset uses the default voice",
    ]);
    expect(sessionStorage.getItem("yui.card-import-notice")).toBe(null);
  });

  it("import success reports the new preset and logs card_import once", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const importPreset = vi.fn(async () => ({ presetId: "abcd1234" }));
    build({ importPreset });
    sec().querySelector<HTMLButtonElement>(".yui-card-import")!.click();
    await vi.waitFor(() => expect(importPreset).toHaveBeenCalledTimes(1));
    expect(info.mock.calls.filter((c) => String(c[0]).includes("card_import"))).toHaveLength(1);
  });

  it("a refused preset creation shows the generic import failure and logs no success", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const importPreset = vi.fn(async () => {
      throw new Error("preset_create_failed");
    });
    build({ importPreset });
    sec().querySelector<HTMLButtonElement>(".yui-card-import")!.click();
    await vi.waitFor(() =>
      expect(sec().querySelector<HTMLElement>(".yui-card__io-error")!.textContent).toBe(
        "Could not import that card",
      ),
    );
    expect(info.mock.calls.some((c) => String(c[0]).includes("card_import"))).toBe(false);
  });

  it("an unreadable payload shows the holds-no-card error", async () => {
    const importPreset = vi.fn(async () => {
      throw new Error("card_unreadable");
    });
    build({ importPreset });
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
    expect(sec().querySelector<HTMLElement>(".yui-card-thumb")!.hidden).toBe(true);
    history.replaceState(null, "", "/?preset=aaaa0001");
    qc.dispose();
    build();
    const thumb = sec().querySelector<HTMLElement>(".yui-card-thumb")!;
    expect(thumb.hidden).toBe(false);
    expect(thumb.querySelector("img")!.src).toBe("asset://localhost/app-data/cards/aaaa0001.png");
  });
});
