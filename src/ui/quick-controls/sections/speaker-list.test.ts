// @vitest-environment jsdom
/**
 * speaker-list.test.ts — the paste-a-voice-id field under providers that accept any voice id
 * (Fish's library voices): hidden otherwise, Enter selects the pasted id even when the list
 * doesn't carry it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeakerSelection } from "../../../io/voice/voices/speaker-selection";
import { setLocale } from "../../i18n";
import { createSpeakerList, speakerPickerHtml } from "./speaker-list";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function buildList(
  canPasteVoiceId: () => boolean,
  overrides: Partial<Parameters<typeof createSpeakerList>[0]> = {},
) {
  const el = document.createElement("div");
  el.innerHTML = speakerPickerHtml();
  const speakerSelection = createSpeakerSelection({
    defaultValue: "natsume",
    available: [{ id: "natsume", label: "Natsume", ref_url: "" }],
  });
  const list = createSpeakerList({
    root: el,
    speakerSelection,
    swapSpeaker: vi.fn(async () => {}),
    refreshSpeaker: vi.fn(async () => {}),
    pickVoiceImport: vi.fn(async () => null),
    commitVoiceImport: vi.fn(async () => {}),
    removeVoice: vi.fn(async () => {}),
    canManageVoices: () => true,
    canReuploadVoices: () => true,
    canPasteVoiceId,
    log: noopLog,
    refreshTooltip: () => {},
    isDisposed: () => false,
    ...overrides,
  });
  list.render();
  return { el, speakerSelection, list };
}

describe("speaker list — paste-a-voice-id field", () => {
  it("shows the field only when the provider accepts a pasted id", () => {
    const without = buildList(() => false);
    expect(without.el.querySelector<HTMLDivElement>(".yui-spk-manual")!.hidden).toBe(true);

    const withField = buildList(() => true);
    expect(withField.el.querySelector<HTMLDivElement>(".yui-spk-manual")!.hidden).toBe(false);
  });

  it("Enter selects a pasted library id that is absent from the list", () => {
    const { el, speakerSelection } = buildList(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "  lib-voice  ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.list()).toContainEqual({
      id: "lib-voice",
      label: "lib-voice",
      ref_url: "",
      source: "user",
      provider: "irodori",
    });
    expect(speakerSelection.getActiveId()).toBe("lib-voice");
    expect(input.value).toBe("");
  });

  it("takes the voice id from a pasted voice page URL", () => {
    const { el, speakerSelection } = buildList(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "https://fish.audio/m/513e5fc83b424eac998e38bb25ee39d7/";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.getActiveId()).toBe("513e5fc83b424eac998e38bb25ee39d7");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("refuses a URL that is not a voice page, selecting nothing", () => {
    for (const url of ["https://fish.audio/app/text-to-speech/", "https://fish.audio/"]) {
      const { el, speakerSelection } = buildList(() => true);
      const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

      input.value = url;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

      expect(input.getAttribute("aria-invalid"), url).toBe("true");
      expect(speakerSelection.listUser(), url).toEqual([]);
      expect(speakerSelection.getActiveId(), url).toBe("natsume");
    }
  });

  it("ignores an empty field", () => {
    const { el, speakerSelection } = buildList(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.listUser()).toEqual([]);
  });

  it("refuses an id the store cannot keep", () => {
    const { el, speakerSelection } = buildList(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "a/b";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.listUser()).toEqual([]);
    expect(speakerSelection.getActiveId()).toBe("natsume");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector(".yui-spk-manual")!.classList.contains("is-invalid")).toBe(true);

    input.value = "lib-voice";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(el.querySelector(".yui-spk-manual")!.classList.contains("is-invalid")).toBe(false);
  });

  it("re-committing an id that is already listed selects it without duplicating the option", () => {
    const { el, speakerSelection } = buildList(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "lib-voice";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.value = "lib-voice";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.listUser().filter((o) => o.id === "lib-voice")).toHaveLength(1);
    expect(speakerSelection.getActiveId()).toBe("lib-voice");
  });
});

describe("speaker list — ids another provider's voice holds", () => {
  beforeEach(() => setLocale("en"));

  it("refuses pasting an id another provider's voice holds, leaving that voice intact", () => {
    const { el, speakerSelection } = buildList(() => true);
    const ayase = {
      id: "ayase",
      label: "Ayase",
      ref_url: "asset://x/ayase.wav",
      source: "user" as const,
      provider: "irodori" as const,
    };
    speakerSelection.addUserOption(ayase);
    speakerSelection.setOwner("fish");
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "ayase";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector(".yui-spk-manual__error")!.textContent).toBe(
      "Another provider's voice already uses this id",
    );
    expect(speakerSelection.listUser()).toEqual([ayase]);
    expect(speakerSelection.getActiveId()).not.toBe("ayase");
  });

  it("an import naming row refuses a name whose id another provider's voice holds", async () => {
    const commitVoiceImport = vi.fn(async () => {});
    const { el, speakerSelection, list } = buildList(() => false, {
      pickVoiceImport: vi.fn(async () => ({ srcPath: "/tmp/ayase.wav", seedName: "ayase" })),
      commitVoiceImport,
    });
    speakerSelection.addUserOption({
      id: "ayase",
      ref_url: "",
      source: "user",
      provider: "fish",
    });
    document.body.append(el);

    list.handleAddClick();
    await vi.waitFor(() => expect(el.querySelector(".yui-spk .yui-ep-input")).not.toBeNull());
    const input = el.querySelector<HTMLInputElement>(".yui-spk .yui-ep-input")!;

    expect(el.textContent).toContain("another provider's voice uses this name");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(commitVoiceImport).not.toHaveBeenCalled();
    el.remove();
  });
});
