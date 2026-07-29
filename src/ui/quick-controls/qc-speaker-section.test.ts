// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/load";
import { createAgentSettings } from "../../io/agent-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createLipsyncSettings } from "../../io/lipsync-settings";
import { createProactiveSettings } from "../../io/proactive-settings";
import { createScheduleSettings } from "../../io/schedule-settings";
import { createSpeakerSelection, type SpeakerOption } from "../../io/speaker-selection";
import type { createVrmSelection } from "../../io/vrm-selection";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
  USER_VOICE,
} from "./test-helpers";

describe("createQuickControls — speaker section", () => {
  let mount: HTMLElement;
  let onGainPreview: Mock<(mouthOpen: number) => void>;
  let onGainPreviewEnd: Mock<() => void>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let proactiveSettings: ReturnType<typeof createProactiveSettings>;
  let scheduleSettings: ReturnType<typeof createScheduleSettings>;
  let onPopOut: Mock<() => void>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: Mock<(option: AvatarOption) => Promise<void>>;
  let importVrm: Mock<() => Promise<void>>;
  let removeUserVrm: Mock<(id: string) => Promise<void>>;
  let speakerSelection: ReturnType<typeof createSpeakerSelection>;
  let swapSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let refreshSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let importVoice: Mock<() => Promise<void>>;
  let removeUserVoice: Mock<(id: string) => Promise<void>>;

  beforeEach(() => {
    // Make rAF synchronous so open() → is-open transition happens immediately in tests
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    mount = document.createElement("div");
    document.body.appendChild(mount);

    onGainPreview = vi.fn<(mouthOpen: number) => void>();
    onGainPreviewEnd = vi.fn<() => void>();
    lipsync = createLipsyncSettings();
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    endpointsSettings = createEndpointsSettings();
    proactiveSettings = createProactiveSettings();
    scheduleSettings = createScheduleSettings();
    onPopOut = vi.fn<() => void>();
    vrmSelection = makeVrmSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapVrm = vi.fn<(option: AvatarOption) => Promise<void>>(async (option) => {
      vrmSelection.select(option.id);
    });
    importVrm = vi.fn<() => Promise<void>>(async () => {});
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {});
    speakerSelection = makeSpeakerSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async (option) => {
      speakerSelection.select(option.id);
    });
    // refresh is server-side only — default fake resolves without touching the store.
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {});
    importVoice = vi.fn<() => Promise<void>>(async () => {});
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    // Existing assertions pin Korean copy/selectors; render the panel in ko.
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      lipsync,
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      proactiveSettings,
      scheduleSettings,
      onPopOut,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      importVoice,
      removeUserVoice,
      ...extra,
    });
  }

  // microtask flush — also declared in qc-vrm-section.test.ts; each split file needs its own copy.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  // ── Speaker section (PR-B B3) ───────────────────────────────────────────────

  it("renders one .yui-spk radio per speakerSelection.list() entry", () => {
    const qc = buildQc();
    qc.open();

    const group = qc.el.querySelector<HTMLElement>(".yui-spks[role=radiogroup]");
    expect(group).not.toBeNull();
    const rows = group!.querySelectorAll<HTMLElement>(".yui-spk[role=radio]");
    expect(rows).toHaveLength(3); // natsume · ayase · rena
    const names = Array.from(rows).map((r) => r.querySelector(".yui-spk__name")!.textContent);
    expect(names).toEqual(["Natsume", "Ayase", "Rena"]);

    qc.dispose();
  });

  it("calls refreshVoiceList on panel open (server may come up after the app)", () => {
    const refreshVoiceList = vi.fn();
    const qc = buildQc({ refreshVoiceList });
    qc.open();

    expect(refreshVoiceList).toHaveBeenCalledOnce();

    qc.dispose();
  });

  it("does not throw on open when refreshVoiceList is absent", () => {
    const qc = buildQc();
    expect(() => qc.open()).not.toThrow();

    qc.dispose();
  });

  it("the speaker section sits AFTER the VRM section", () => {
    const qc = buildQc();
    qc.open();

    const vrmGroup = qc.el.querySelector(".yui-vrms[role=radiogroup]")!;
    const spkGroup = qc.el.querySelector(".yui-spks[role=radiogroup]")!;
    // DOCUMENT_POSITION_FOLLOWING (4) → spkGroup comes after vrmGroup in document order
    expect(
      vrmGroup.compareDocumentPosition(spkGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    qc.dispose();
  });

  it("marks the active speaker row aria-checked and shows the '사용 중' badge", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Natsume");
    expect(active.querySelector(".yui-spk__badge")!.textContent).toBe("사용 중");
    for (const r of rows) {
      if (r !== active) expect(r.querySelector(".yui-spk__badge")).toBeNull();
    }

    qc.dispose();
  });

  it("roving tabindex: active speaker row tabindex=0, others -1", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows[0].tabIndex).toBe(0); // active (natsume)
    expect(rows[1].tabIndex).toBe(-1);
    expect(rows[2].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("clicking a non-active speaker row calls swapSpeaker with that option and shows loading", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const ayase = rows[1];
    ayase.click();

    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({
      id: "ayase",
      ref_url: "/references/ayase.wav",
    });

    // loading reflected immediately (before the promise resolves)
    expect(ayase.getAttribute("aria-busy")).toBe("true");
    expect(ayase.querySelector(".yui-spk__hint")!.textContent).toContain("바꾸는 중");
    const group = qc.el.querySelector<HTMLElement>(".yui-spks")!;
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(true);

    qc.dispose();
  });

  it("on resolve the active tick + badge move to the new speaker row and loading clears", async () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].click(); // Ayase
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Ayase");
    expect(active.querySelector(".yui-spk__badge")!.textContent).toBe("사용 중");
    expect(qc.el.querySelector(".yui-spk[aria-busy=true]")).toBeNull();
    const group = qc.el.querySelector<HTMLElement>(".yui-spks")!;
    expect(group.getAttribute("aria-busy")).not.toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(false);
    expect(speakerSelection.getActiveId()).toBe("ayase");

    qc.dispose();
  });

  it("on reject shows the inline speaker error and leaves the active selection unchanged", async () => {
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {
      throw new Error("clone failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[2].click(); // Rena
    await flush();

    const errorRow = qc.el.querySelector<HTMLElement>(".yui-spk.is-error")!;
    expect(errorRow.querySelector(".yui-spk__name")!.textContent).toBe("Rena");
    const errMsg = qc.el.querySelector(".yui-spk__error")!;
    expect(errMsg.textContent).toContain("불러오지 못했어요");
    expect(speakerSelection.getActiveId()).toBe("natsume");
    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Natsume");
    expect(qc.el.querySelector(".yui-spk[aria-busy=true]")).toBeNull();

    qc.dispose();
  });

  it("clicking the already-active speaker row is a no-op (no swapSpeaker)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    active.click();

    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("the speaker '파일에서 추가…' row is an enabled button (irodori) and click invokes importVoice", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const add = qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!;
    expect(add.disabled).toBe(false);
    expect(add.getAttribute("role")).not.toBe("radio");
    expect(add.querySelector(".yui-spk__soon")).toBeNull(); // no "준비 중" chip anymore

    add.click();
    expect(importVoice).toHaveBeenCalledOnce();
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  // ── Speaker: user (imported) voice management — mirrors the VRM section ──────

  function withUserVoice() {
    speakerSelection = makeSpeakerSelection();
    speakerSelection.addUserVoice(USER_VOICE);
  }

  function userSpkRow(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`.yui-spk[data-spk-id="${USER_VOICE.id}"]`)!;
  }

  it("renders a user voice row carrying rename + remove + audition controls", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const row = userSpkRow(qc);
    expect(row).not.toBeNull();
    expect(row.tagName).toBe("DIV");
    expect(row.getAttribute("role")).toBe("radio");
    expect(row.querySelector(".yui-spk__name")!.textContent).toBe("내 목소리");
    expect(row.querySelector<HTMLButtonElement>(".yui-spk__rename")).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>(".yui-spk__remove")).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>(".yui-spk__preview")).not.toBeNull();

    qc.dispose();
  });

  it("bundled speaker rows carry no rename/remove controls", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const natsume = qc.el.querySelector<HTMLElement>('.yui-spk[data-spk-id="natsume"]')!;
    expect(natsume.querySelector(".yui-spk__rename")).toBeNull();
    expect(natsume.querySelector(".yui-spk__remove")).toBeNull();
    // bundled still has refresh + preview
    expect(natsume.querySelector(".yui-spk__preview")).not.toBeNull();

    qc.dispose();
  });

  it("pencil opens inline rename; Enter commits via renameUserVoice", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__rename")!.click();

    const row = userSpkRow(qc);
    expect(row.classList.contains("yui-spk--renaming")).toBe(true);
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("내 목소리");
    expect(row.querySelector(".yui-spk__rename-hint")).not.toBeNull();

    input.value = "새 목소리";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(speakerSelection.getOptions().find((o) => o.id === "myvoice")!.label).toBe("새 목소리");
    expect(userSpkRow(qc).querySelector(".yui-ep-input")).toBeNull();

    qc.dispose();
  });

  it("Esc cancels inline speaker rename without changing the label or closing the panel", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__rename")!.click();
    const input = userSpkRow(qc).querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = "버려질 이름";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(speakerSelection.getOptions().find((o) => o.id === "myvoice")!.label).toBe("내 목소리");
    expect(userSpkRow(qc).querySelector(".yui-ep-input")).toBeNull();
    expect(qc.isOpen()).toBe(true);

    qc.dispose();
  });

  it("trash removes the voice via injected removeUserVoice then store removeUserVoice", async () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(removeUserVoice).toHaveBeenCalledOnce();
    expect(removeUserVoice.mock.calls[0][0]).toBe("myvoice");
    expect(speakerSelection.getOptions().map((o) => o.id)).not.toContain("myvoice");
    expect(qc.el.querySelector('.yui-spk[data-spk-id="myvoice"]')).toBeNull();

    qc.dispose();
  });

  it("deletes the voice file BEFORE committing the store removal (no divergence ordering)", async () => {
    withUserVoice();
    let storeStillHadVoiceAtDelete: boolean | null = null;
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {
      storeStillHadVoiceAtDelete = speakerSelection.getOptions().some((o) => o.id === "myvoice");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(storeStillHadVoiceAtDelete).toBe(true);
    expect(speakerSelection.getOptions().map((o) => o.id)).not.toContain("myvoice");

    qc.dispose();
  });

  it("keeps the voice in the store when the native file delete fails (no divergence)", async () => {
    withUserVoice();
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(speakerSelection.getOptions().map((o) => o.id)).toContain("myvoice");
    expect(qc.el.querySelector('.yui-spk[data-spk-id="myvoice"]')).not.toBeNull();

    qc.dispose();
  });

  it("does NOT fall back / swap the speaker when deleting the active voice file fails", async () => {
    withUserVoice();
    speakerSelection.select("myvoice");
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();
    swapSpeaker.mockClear();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    expect(speakerSelection.getActiveId()).toBe("myvoice");
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("removing the active user voice falls back to default and swaps the speaker", async () => {
    withUserVoice();
    speakerSelection.select("myvoice");
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    await flush();

    // store fell back to the bundled default
    expect(speakerSelection.getActiveId()).toBe("natsume");
    // speaker reloaded onto the fallback
    expect(swapSpeaker).toHaveBeenCalled();
    expect(swapSpeaker.mock.calls.at(-1)![0]).toMatchObject({ id: "natsume" });

    qc.dispose();
  });

  it("clicking add enters the importing state (loading row)", () => {
    importVoice = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}));
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();

    const loading = qc.el.querySelector<HTMLElement>(".yui-spk__loading")!;
    expect(loading).not.toBeNull();
    expect(loading.querySelector(".yui-spk__spin")).not.toBeNull();
    expect(loading.querySelector(".yui-spk__loading-name")!.textContent).toContain("불러오는 중");

    qc.dispose();
  });

  it("a failed voice import shows the inline error and clears the importing row", async () => {
    importVoice = vi.fn<() => Promise<void>>(async () => {
      throw new Error("bad voice");
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();
    await flush();

    const err = qc.el.querySelector<HTMLElement>(".yui-spk__import-error")!;
    expect(err).not.toBeNull();
    expect(err.hidden).toBe(false);
    expect(qc.el.querySelector(".yui-spk__loading")).toBeNull();

    qc.dispose();
  });

  it("a successful voice import clears the importing row and error notice", async () => {
    importVoice = vi.fn<() => Promise<void>>(async () => {
      speakerSelection.addUserVoice(USER_VOICE);
    });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();
    await flush();

    expect(qc.el.querySelector(".yui-spk__loading")).toBeNull();
    expect(qc.el.querySelector<HTMLElement>(".yui-spk__import-error")!.hidden).toBe(true);
    expect(qc.el.querySelector('.yui-spk[data-spk-id="myvoice"]')).not.toBeNull();

    qc.dispose();
  });

  it("when provider=openai the add button does not import and user controls are absent", () => {
    withUserVoice();
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    // whole speaker section disabled (pointer-events:none via .is-disabled)
    const foot = qc.el.querySelector<HTMLElement>(".yui-spk-foot")!;
    expect(foot.classList.contains("is-disabled")).toBe(true);
    const scroll = qc.el.querySelector<HTMLElement>(".yui-spk-scroll")!;
    expect(scroll.classList.contains("is-disabled")).toBe(true);

    // even if the click handler fires, it must not import while openai is effective
    qc.el.querySelector<HTMLButtonElement>(".yui-spk--add")!.click();
    expect(importVoice).not.toHaveBeenCalled();

    // a remove click on a user row must not delete while openai is effective
    userSpkRow(qc).querySelector<HTMLButtonElement>(".yui-spk__remove")!.click();
    expect(removeUserVoice).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("caps the speaker list in a scroll container; the add-row footer lives OUTSIDE it", () => {
    const qc = buildQc();
    qc.open();

    const scroll = qc.el.querySelector<HTMLElement>(".yui-spk-scroll")!;
    const group = qc.el.querySelector<HTMLElement>(".yui-spks")!;
    const foot = qc.el.querySelector<HTMLElement>(".yui-spk-foot")!;
    expect(scroll.contains(group)).toBe(true);
    expect(scroll.contains(foot)).toBe(false);
    expect(foot.querySelector(".yui-spk--add")).not.toBeNull();

    qc.dispose();
  });

  it("openai gates the speaker option buttons with the real disabled attribute", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__refresh")!.disabled).toBe(true);
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__preview")!.disabled).toBe(true);
    }

    qc.dispose();
  });

  it("irodori leaves clip-backed speaker option buttons enabled (not disabled)", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    // default speakers all carry a ref_url (clip) → option buttons are enabled.
    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    for (const r of rows) {
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__refresh")!.disabled).toBe(false);
      expect(r.querySelector<HTMLButtonElement>(".yui-spk__preview")!.disabled).toBe(false);
    }

    qc.dispose();
  });

  it("openai: row click and Enter/Space do NOT swap, and rows are not tabbable", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows.length).toBeGreaterThan(0);

    // (c) When inactive, all rows are skipped in Tab navigation.
    for (const r of rows) expect(r.tabIndex).toBe(-1);

    // (a) Clicking an inactive row does not trigger swap (CSS pointer-events cannot block keyboard).
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(swapSpeaker).not.toHaveBeenCalled();

    // (b) Enter/Space after focus also does not swap.
    rows[1].focus();
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("irodori: a row click swaps and the roved row is tabbable (tabIndex 0)", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    // Active (default selected) row has roving tabindex 0.
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.tabIndex).toBe(0);

    // Click inactive row → swap.
    rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({ id: "ayase" });

    qc.dispose();
  });

  it("switching the engine to openai while open disables the speaker option buttons", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const refreshBefore = qc.el.querySelector<HTMLButtonElement>(
      ".yui-spk[role=radio] .yui-spk__refresh",
    )!;
    expect(refreshBefore.disabled).toBe(false);

    const sel = qc.el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
    sel.value = "openai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));

    const refreshAfter = qc.el.querySelector<HTMLButtonElement>(
      ".yui-spk[role=radio] .yui-spk__refresh",
    )!;
    expect(refreshAfter.disabled).toBe(true);

    qc.dispose();
  });

  it("re-enables speaker rows after a provider change that happened while closed", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    // Change to openai while closed — onOpen must resynchronize the enabled baseline.
    endpointsSettings.set({ tts_provider: "openai" });
    qc.open();

    const refreshDisabled = qc.el.querySelector<HTMLButtonElement>(
      ".yui-spk[role=radio] .yui-spk__refresh",
    )!;
    expect(refreshDisabled.disabled).toBe(true); // openai → inactive

    // Return to irodori while open — rows must re-enable (baseline is stale, so skip).
    endpointsSettings.set({ tts_provider: "irodori" });
    const refreshEnabled = qc.el.querySelector<HTMLButtonElement>(
      ".yui-spk[role=radio] .yui-spk__refresh",
    )!;
    expect(refreshEnabled.disabled).toBe(false);

    qc.dispose();
  });

  it("Enter on a focused non-active speaker row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({ id: "ayase" });

    qc.dispose();
  });

  it("Space on a focused non-active speaker row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(swapSpeaker).toHaveBeenCalledOnce();
    expect(swapSpeaker.mock.calls[0][0]).toMatchObject({ id: "rena" });

    qc.dispose();
  });

  it("ArrowDown moves roving focus to the next speaker row WITHOUT swapping", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    // roving focus moved; selection unchanged until Enter/Space
    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);
    // manual activation: roving moves focus only — selection (aria-checked) must not follow
    expect(rows[1].getAttribute("aria-checked")).toBe("false");
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(swapSpeaker).not.toHaveBeenCalled();
    expect(speakerSelection.getActiveId()).toBe("natsume");

    qc.dispose();
  });

  it("ArrowUp wraps roving focus from the first to the last speaker row", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));

    expect(document.activeElement).toBe(rows[2]);

    qc.dispose();
  });

  it("keeps the roving speaker tabindex on the last-roved row across a re-render", async () => {
    // A rejected commit on a different row re-renders (finally → renderSpeakers) while the
    // active id stays put — the seam that proves roving-tabindex survives a real re-render.
    swapSpeaker = vi.fn(async () => {
      throw new Error("swap failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[0].focus();
    // rove down to Ayase (unchecked) without committing → spkRovedId = ayase
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[1].tabIndex).toBe(0);

    // commit Rena (a DIFFERENT row than the roved Ayase); its swap REJECTS, so active stays
    // natsume but finally still re-renders. A wrong rovedId re-point on commit would move
    // the tab stop to Rena — this asserts it stays on the roved Ayase.
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(speakerSelection.getActiveId()).toBe("natsume"); // rejected swap left active untouched
    // roving tabindex must remain on Ayase — not snap to the checked Natsume, nor to Rena
    expect(after[1].tabIndex).toBe(0);
    expect(after[0].tabIndex).toBe(-1);
    expect(after[2].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("clicking the ▶ preview button does NOT trigger row selection", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const preview = rows[1].querySelector<HTMLButtonElement>(".yui-spk__preview")!;
    expect(preview).not.toBeNull();
    preview.click();

    // the preview audition must not select/swap the row
    expect(swapSpeaker).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("routes the audition url through the asset resolver before constructing Audio", async () => {
    const resolveAuditionUrl = vi.fn(async (u: string) => `resolved://${u}`);
    const seen: string[] = [];
    class FakeAudio {
      src: string;
      constructor(src: string) {
        this.src = src;
        seen.push(src);
      }
      addEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
    }
    const OrigAudio = globalThis.Audio;
    (globalThis as { Audio: unknown }).Audio = FakeAudio as unknown;
    try {
      const qc = buildQc({ resolveAuditionUrl });
      qc.open();

      const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
      rows[1].querySelector<HTMLButtonElement>(".yui-spk__preview")!.click();
      await flush();

      expect(resolveAuditionUrl).toHaveBeenCalledWith("/references/ayase.wav");
      expect(seen).toEqual(["resolved:///references/ayase.wav"]);

      qc.dispose();
    } finally {
      (globalThis as { Audio: unknown }).Audio = OrigAudio;
    }
  });

  it("disables the ▶ preview button when a speaker has an empty ref_url", () => {
    speakerSelection = createSpeakerSelection({
      available: [
        { id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" },
        { id: "noclip", label: "Noclip", ref_url: "" },
      ],
      defaultId: "natsume",
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const withClip = rows[0].querySelector<HTMLButtonElement>(".yui-spk__preview")!;
    const noClip = rows[1].querySelector<HTMLButtonElement>(".yui-spk__preview")!;
    expect(withClip.disabled).toBe(false);
    expect(noClip.disabled).toBe(true);

    qc.dispose();
  });

  it("reflects an external speakerSelection change (cross-window) while open", () => {
    const qc = buildQc();
    qc.open();

    speakerSelection.select("rena");

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-spk__name")!.textContent).toBe("Rena");

    qc.dispose();
  });

  it("renders a speaker label with HTML metacharacters as literal text (no innerHTML injection)", () => {
    const evil = "a<img src=x onerror=alert(1)>b";
    speakerSelection = createSpeakerSelection({
      available: [{ id: "natsume", label: evil, ref_url: "/references/natsume.wav" }],
      defaultId: "natsume",
    });
    const qc = buildQc();
    qc.open();

    const name = qc.el.querySelector<HTMLElement>(".yui-spk[role=radio] .yui-spk__name")!;
    expect(name.textContent).toBe(evil);
    expect(name.querySelector("img")).toBeNull();
    expect(qc.el.querySelector(".yui-spks img")).toBeNull();

    qc.dispose();
  });

  it("activates a speaker whose id contains a double-quote without throwing (CSS.escape)", async () => {
    const evilId = 'ナ"ツメ';
    speakerSelection = createSpeakerSelection({
      available: [
        { id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" },
        { id: evilId, label: "Quoted", ref_url: "/references/quoted.wav" },
      ],
      defaultId: "natsume",
    });
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async (option) => {
      speakerSelection.select(option.id);
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const quoted = rows.find((r) => r.dataset.spkId === evilId)!;
    expect(quoted).toBeDefined();

    // clicking would throw SyntaxError inside spkRowById if the selector were unescaped
    expect(() => quoted.click()).not.toThrow();
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.dataset.spkId).toBe(evilId);
    expect(speakerSelection.getActiveId()).toBe(evilId);

    qc.dispose();
  });

  it("window variant also renders the speaker section", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-spks[role=radiogroup]")).not.toBeNull();
    expect(qc.el.querySelector(".yui-spk--add")).not.toBeNull();

    qc.dispose();
  });

  // ── Speaker row reference-voice refresh button ──────────────────────────────

  it("renders a .yui-spk__refresh button per speaker row, before the ▶ preview", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      const refresh = r.querySelector<HTMLButtonElement>(".yui-spk__refresh");
      const preview = r.querySelector<HTMLButtonElement>(".yui-spk__preview");
      expect(refresh).not.toBeNull();
      expect(preview).not.toBeNull();
      // refresh sits BEFORE preview in source/visual order
      expect(
        refresh!.compareDocumentPosition(preview!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    qc.dispose();
  });

  it("disables the refresh button when a speaker has an empty ref_url", () => {
    speakerSelection = createSpeakerSelection({
      available: [
        { id: "natsume", label: "Natsume", ref_url: "/references/natsume.wav" },
        { id: "noclip", label: "Noclip", ref_url: "" },
      ],
      defaultId: "natsume",
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const withClip = rows[0].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    const noClip = rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    expect(withClip.disabled).toBe(false);
    expect(noClip.disabled).toBe(true);

    qc.dispose();
  });

  it("clicking the refresh button calls refreshSpeaker and does NOT change the active selection", async () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const ayase = rows[1]; // non-active
    const refresh = ayase.querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    refresh.click();

    expect(refreshSpeaker).toHaveBeenCalledOnce();
    expect(refreshSpeaker.mock.calls[0][0]).toMatchObject({
      id: "ayase",
      ref_url: "/references/ayase.wav",
    });
    // refresh must not select/swap the row (stopPropagation) — active stays natsume
    expect(swapSpeaker).not.toHaveBeenCalled();
    expect(speakerSelection.getActiveId()).toBe("natsume");

    await flush();
    expect(speakerSelection.getActiveId()).toBe("natsume");

    qc.dispose();
  });

  it("on a rejected refreshSpeaker the row gets the error state", async () => {
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {
      throw new Error("update failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[2].querySelector<HTMLButtonElement>(".yui-spk__refresh")!.click(); // Rena
    await flush();

    const errorRow = qc.el.querySelector<HTMLElement>(".yui-spk.is-error")!;
    expect(errorRow).not.toBeNull();
    expect(errorRow.querySelector(".yui-spk__name")!.textContent).toBe("Rena");
    expect(errorRow.getAttribute("aria-invalid")).toBe("true");
    const errMsg = qc.el.querySelector(".yui-spk__error")!;
    expect(errMsg.textContent).toContain("갱신하지 못했어요");
    // refresh leaves the active selection untouched
    expect(speakerSelection.getActiveId()).toBe("natsume");

    qc.dispose();
  });

  it("shows the success note after a resolved refresh, then auto-reverts to idle", async () => {
    vi.useFakeTimers();
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!.click(); // Ayase
    await vi.advanceTimersByTimeAsync(0); // let the refreshSpeaker promise settle

    expect(qc.el.querySelector(".yui-spk__note")).not.toBeNull();
    expect(qc.el.querySelector(".yui-spk__note")!.textContent).toContain("갱신했어요");

    // auto-revert clears the note after the dwell
    await vi.advanceTimersByTimeAsync(2400);
    expect(qc.el.querySelector(".yui-spk__note")).toBeNull();

    qc.dispose();
    vi.useRealTimers();
  });

  it("ignores a re-entrant refresh while the same row is already refreshing", async () => {
    let resolveRefresh: () => void = () => {};
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(
      () =>
        new Promise<void>((res) => {
          resolveRefresh = res;
        }),
    );
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    const refresh = rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    refresh.click();
    // a second click while in-flight must be ignored (button is also disabled, but guard defends)
    const stillRefresh = qc.el
      .querySelectorAll<HTMLElement>(".yui-spk[role=radio]")[1]
      .querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
    stillRefresh.click();

    expect(refreshSpeaker).toHaveBeenCalledOnce();

    resolveRefresh?.();
    await flush();

    qc.dispose();
  });

  it("does not render the success note or schedule a dwell timer when disposed mid-refresh", async () => {
    vi.useFakeTimers();
    let resolveRefresh: () => void = () => {};
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(
      () =>
        new Promise<void>((res) => {
          resolveRefresh = res;
        }),
    );
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-spk[role=radio]"));
    rows[1].querySelector<HTMLButtonElement>(".yui-spk__refresh")!.click(); // Ayase

    // dispose while the refresh promise is still pending
    qc.dispose();

    // the now-resolving refresh must not write to the torn-down DOM
    resolveRefresh?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(qc.el.querySelector(".yui-spk__note")).toBeNull();

    // and no leaked dwell timer fires the note later
    await vi.advanceTimersByTimeAsync(2400);
    expect(qc.el.querySelector(".yui-spk__note")).toBeNull();

    vi.useRealTimers();
  });
});
