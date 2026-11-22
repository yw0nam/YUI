// @vitest-environment jsdom
/**
 * speaker-section.test.tsx — the paste-a-voice-id field under providers that accept any voice id
 * (Fish's library voices): hidden otherwise, Enter selects the pasted id even when the list
 * doesn't carry it. Also the store subscription's open and mid-swap guards.
 */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSpeakerSelection } from "../../../../io/voice/voices/speaker-selection";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createFillerSettings } from "../../../../settings/voice/filler-settings";
import { setLocale } from "../../../i18n";
import { createSwitchRows } from "../../switch-row";
import "../../test-helpers";
import { createVoicePage, type VoicePage } from "../voice-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const pages: VoicePage[] = [];

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
});

function buildPage(
  canPasteVoiceId: () => boolean,
  overrides: Partial<Parameters<typeof createVoicePage>[0]> = {},
) {
  const fillerSettings = createFillerSettings();
  const speakerSelection = createSpeakerSelection({
    defaultValue: "natsume",
    available: [{ id: "natsume", label: "Natsume", ref_url: "" }],
  });
  const page = createVoicePage({
    rows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      fillerSettings,
    }).filter((row) => row.tab === "voice"),
    fillerSettings,
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
    isOpen: () => true,
    ...overrides,
  });
  pages.push(page);
  document.body.append(page.el);
  return { el: page.el, speakerSelection, page };
}

const pressEnter = (input: HTMLInputElement) =>
  act(() => {
    fireEvent.keyDown(input, { key: "Enter" });
  });

describe("speaker list — paste-a-voice-id field", () => {
  it("shows the field only when the provider accepts a pasted id", () => {
    const without = buildPage(() => false);
    expect(without.el.querySelector<HTMLDivElement>(".yui-spk-manual")!.hidden).toBe(true);

    const withField = buildPage(() => true);
    expect(withField.el.querySelector<HTMLDivElement>(".yui-spk-manual")!.hidden).toBe(false);
  });

  it("Enter selects a pasted library id that is absent from the list", () => {
    const { el, speakerSelection } = buildPage(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "  lib-voice  ";
    pressEnter(input);

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
    const { el, speakerSelection } = buildPage(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "https://fish.audio/m/513e5fc83b424eac998e38bb25ee39d7/";
    pressEnter(input);

    expect(speakerSelection.getActiveId()).toBe("513e5fc83b424eac998e38bb25ee39d7");
    expect(input.getAttribute("aria-invalid")).toBe("false");
  });

  it("refuses a URL that is not a voice page, selecting nothing", () => {
    for (const url of ["https://fish.audio/app/text-to-speech/", "https://fish.audio/"]) {
      const { el, speakerSelection } = buildPage(() => true);
      const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

      input.value = url;
      pressEnter(input);

      expect(input.getAttribute("aria-invalid"), url).toBe("true");
      expect(speakerSelection.listUser(), url).toEqual([]);
      expect(speakerSelection.getActiveId(), url).toBe("natsume");
    }
  });

  it("ignores an empty field", () => {
    const { el, speakerSelection } = buildPage(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "   ";
    pressEnter(input);

    expect(speakerSelection.listUser()).toEqual([]);
  });

  it("refuses an id the store cannot keep", () => {
    const { el, speakerSelection } = buildPage(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "a/b";
    pressEnter(input);

    expect(speakerSelection.listUser()).toEqual([]);
    expect(speakerSelection.getActiveId()).toBe("natsume");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector(".yui-spk-manual")!.classList.contains("is-invalid")).toBe(true);

    input.value = "lib-voice";
    pressEnter(input);
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(el.querySelector(".yui-spk-manual")!.classList.contains("is-invalid")).toBe(false);
  });

  it("re-committing an id that is already listed selects it without duplicating the option", () => {
    const { el, speakerSelection } = buildPage(() => true);
    const input = el.querySelector<HTMLInputElement>(".yui-spk-manual input")!;

    input.value = "lib-voice";
    pressEnter(input);
    input.value = "lib-voice";
    pressEnter(input);

    expect(speakerSelection.listUser().filter((o) => o.id === "lib-voice")).toHaveLength(1);
    expect(speakerSelection.getActiveId()).toBe("lib-voice");
  });
});

describe("speaker list — ids another provider's voice holds", () => {
  beforeEach(() => setLocale("en"));

  it("refuses pasting an id another provider's voice holds, leaving that voice intact", () => {
    const { el, speakerSelection } = buildPage(() => true);
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
    pressEnter(input);

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector(".yui-spk-manual__error")!.textContent).toBe(
      "Another provider's voice already uses this id",
    );
    expect(speakerSelection.listUser()).toEqual([ayase]);
    expect(speakerSelection.getActiveId()).not.toBe("ayase");
  });

  it("an import naming row refuses a name whose id another provider's voice holds", async () => {
    const commitVoiceImport = vi.fn(async () => {});
    const { el, speakerSelection } = buildPage(() => false, {
      pickVoiceImport: vi.fn(async () => ({
        stagedId: "import-ayase",
        seedName: "ayase",
        discard: vi.fn(async () => {}),
      })),
      commitVoiceImport,
    });
    act(() => {
      speakerSelection.addUserOption({
        id: "ayase",
        ref_url: "",
        source: "user",
        provider: "fish",
      });
    });

    act(() => el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click());
    await vi.waitFor(() => expect(el.querySelector(".yui-spk .yui-ep-input")).not.toBeNull());
    const input = el.querySelector<HTMLInputElement>(".yui-spk .yui-ep-input")!;

    expect(el.textContent).toContain("another provider's voice uses this name");
    pressEnter(input);
    expect(commitVoiceImport).not.toHaveBeenCalled();
    expect(el.querySelector(".yui-spk .yui-ep-input")).not.toBeNull();
  });
});

describe("speaker list — store subscription", () => {
  function build({
    open = true,
    swapSpeaker = vi.fn(async () => {}),
  }: {
    open?: boolean;
    swapSpeaker?: () => Promise<void>;
  } = {}) {
    const speakerSelection = createSpeakerSelection({
      defaultValue: "natsume",
      available: [
        { id: "natsume", label: "Natsume", ref_url: "" },
        { id: "ayase", label: "Ayase", ref_url: "" },
      ],
    });
    const { el } = buildPage(() => false, { speakerSelection, swapSpeaker, isOpen: () => open });
    const rows = () => Array.from(el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const checked = () =>
      rows().find((r) => r.getAttribute("aria-checked") === "true")!.dataset.spkId;
    return { speakerSelection, rows, checked };
  }

  it("a store change re-renders the rows while open, not while closed and not mid-swap", () => {
    const closed = build({ open: false });
    act(() => closed.speakerSelection.select("ayase"));
    expect(closed.checked()).toBe("natsume");

    const opened = build();
    act(() => opened.speakerSelection.select("ayase"));
    expect(opened.checked()).toBe("ayase");

    const swapping = build({ swapSpeaker: () => new Promise<void>(() => {}) });
    act(() => swapping.rows()[1].click());
    act(() => swapping.speakerSelection.select("ayase"));
    expect(swapping.checked()).toBe("natsume");
  });
});
