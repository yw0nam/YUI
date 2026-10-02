// @vitest-environment jsdom
/**
 * speaker-list.test.ts — the paste-a-voice-id field under providers that accept any voice id
 * (Fish's library voices): hidden otherwise, Enter selects the pasted id even when the list
 * doesn't carry it.
 */

import { describe, expect, it, vi } from "vitest";
import { createSpeakerSelection } from "../../../io/voice/voices/speaker-selection";
import { createSpeakerList, speakerPickerHtml } from "./speaker-list";

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function buildList(canPasteVoiceId: () => boolean) {
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
    canPasteVoiceId,
    log: noopLog,
    refreshTooltip: () => {},
    isDisposed: () => false,
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
    });
    expect(speakerSelection.getActiveId()).toBe("lib-voice");
    expect(input.value).toBe("");
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
