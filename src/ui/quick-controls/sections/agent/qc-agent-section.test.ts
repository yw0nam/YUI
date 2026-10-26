// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../../../config/validators/avatar/types";
import type { createVrmSelection } from "../../../../io/assets/vrm-selection";
import type {
  createSpeakerSelection,
  SpeakerOption,
} from "../../../../io/voice/voices/speaker-selection";
import type { PickedVoiceImport } from "../../../../io/voice/voices/voice-import-flow";
import { createLipsyncSettings } from "../../../../settings/avatar/lipsync-settings";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import { createEndpointsSettings } from "../../../../settings/backend/endpoints-settings";
import { createProactiveSettings } from "../../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../../settings/cues/schedule-settings";
import {
  getLocale,
  subscribe as i18nSubscribe,
  LOCALE_DISPLAY_NAMES,
  setLocale,
} from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import {
  countSubscriptions,
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
} from "../../test-helpers";

describe("createQuickControls — agent section", () => {
  let mount: HTMLElement;
  let onGainPreview: Mock<(mouthOpen: number) => void>;
  let onGainPreviewEnd: Mock<() => void>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let proactiveSettings: ReturnType<typeof createProactiveSettings>;
  let scheduleSettings: ReturnType<typeof createScheduleSettings>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: Mock<(option: AvatarOption) => Promise<void>>;
  let importVrm: Mock<() => Promise<void>>;
  let removeUserVrm: Mock<(id: string) => Promise<void>>;
  let speakerSelection: ReturnType<typeof createSpeakerSelection>;
  let swapSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let refreshSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let pickVoiceImport: Mock<() => Promise<PickedVoiceImport | null>>;
  let commitVoiceImport: Mock<(stagedId: string, name: string) => Promise<void>>;
  let removeVoice: Mock<(id: string) => Promise<void>>;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);

    onGainPreview = vi.fn<(mouthOpen: number) => void>();
    onGainPreviewEnd = vi.fn<() => void>();
    lipsync = createLipsyncSettings();
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    endpointsSettings = createEndpointsSettings();
    proactiveSettings = createProactiveSettings();
    scheduleSettings = createScheduleSettings();
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
    pickVoiceImport = vi.fn<() => Promise<PickedVoiceImport | null>>(async () => null);
    commitVoiceImport = vi.fn<(stagedId: string, name: string) => Promise<void>>(async () => {});
    removeVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      // Ignore environments without localStorage
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
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      pickVoiceImport,
      commitVoiceImport,
      removeVoice,
      ...extra,
    });
  }

  // ── Chat (Agent) section: reasoning effort segmented control ───────────────

  it("clicking the Medium segment sets reasoning_effort and marks it selected", () => {
    const qc = buildQc();
    qc.open();

    const seg = qc.el.querySelector<HTMLElement>(".yui-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // order: none · minimal · low · medium
    expect(btns).toHaveLength(4);
    const medium = btns[3];

    medium.click();

    expect(agentSettings.get().reasoning_effort).toBe("medium");
    expect(medium.getAttribute("aria-checked")).toBe("true");
    for (const b of btns) {
      if (b !== medium) expect(b.getAttribute("aria-checked")).toBe("false");
    }

    qc.dispose();
  });

  it("ArrowRight on the segmented control moves selection (roving) and updates the store", () => {
    const qc = buildQc();
    qc.open();

    const seg = qc.el.querySelector<HTMLElement>(".yui-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // start at none (index 0)
    expect(btns[0].getAttribute("aria-checked")).toBe("true");

    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(agentSettings.get().reasoning_effort).toBe("minimal");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");
    expect(btns[0].getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  // ── reflect store state on open ───────────────────────────────────────────

  it("open() reflects the store's reasoning_effort", () => {
    agentSettings.setReasoningEffort("medium");

    const qc = buildQc();
    qc.open();

    const btns = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[3].getAttribute("aria-checked")).toBe("true"); // medium
    expect(btns[0].getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("external agent settings change reflects in the panel while open", () => {
    const qc = buildQc();
    qc.open();

    agentSettings.setReasoningEffort("low");

    const btns = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[2].getAttribute("aria-checked")).toBe("true"); // low

    qc.dispose();
  });

  it("releases every agent settings subscription on dispose", () => {
    const counts = countSubscriptions(agentSettings);
    const qc = buildQc();

    qc.dispose();

    expect(counts.taken).toBeGreaterThan(0);
    expect(counts.released).toBe(counts.taken);
  });

  describe("transport-dependent controls", () => {
    function agentControls(qc: ReturnType<typeof buildQc>) {
      const effortSec = qc.el.querySelector(".yui-effort-seg")!.closest<HTMLElement>(".yui-sec")!;
      const localeRow = qc.el.querySelector(".yui-lang-seg")!.closest<HTMLElement>(".yui-row")!;
      const reason = effortSec.querySelector<HTMLElement>(".yui-push-reason")!;
      const disabled = () =>
        [...effortSec.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")].every(
          (b) => b.disabled,
        );
      return { effortSec, localeRow, reason, disabled };
    }

    it("disables the effort segment on the push transport with its reason, keeps the locale picker", () => {
      endpointsSettings.set({ chat_api: "push" });
      const qc = buildQc();
      qc.open();

      const { effortSec, localeRow, reason, disabled } = agentControls(qc);
      expect(effortSec.hidden).toBe(false);
      expect(disabled()).toBe(true);
      expect(reason.hidden).toBe(false);
      expect(reason.textContent).toContain("푸시에서는 얼마나 생각할지 백엔드가 정해요.");
      expect(localeRow.hidden).toBe(false);

      qc.dispose();
    });

    it("follows a live transport change in both directions", () => {
      endpointsSettings.set({ chat_api: "responses" });
      const qc = buildQc();
      qc.open();
      const { reason, disabled } = agentControls(qc);

      endpointsSettings.set({ chat_api: "push" });
      expect([disabled(), reason.hidden]).toEqual([true, false]);

      endpointsSettings.set({ chat_api: "responses" });
      expect([disabled(), reason.hidden]).toEqual([false, true]);

      qc.dispose();
    });

    it("disables the segment when the bundled default transport is push", () => {
      const qc = buildQc({ getDefaultChatApi: () => "push" });
      qc.open();

      expect(agentControls(qc).disabled()).toBe(true);

      qc.dispose();
    });

    it("keeps the stored effort while the control is disabled", () => {
      agentSettings.setReasoningEffort("medium");
      endpointsSettings.set({ chat_api: "push" });
      const qc = buildQc();
      qc.open();

      expect(agentSettings.get().reasoning_effort).toBe("medium");

      qc.dispose();
    });

    it("releases every endpoints settings subscription on dispose", () => {
      const counts = countSubscriptions(endpointsSettings);
      const qc = buildQc();

      qc.dispose();

      expect(counts.taken).toBeGreaterThan(0);
      expect(counts.released).toBe(counts.taken);
    });
  });
});

describe("createQuickControls — language picker", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      ...extra,
    });
  }

  it("renders a 3-way language segmented control with display names", () => {
    const qc = buildQc();
    qc.open();
    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    expect(seg).not.toBeNull();
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    const locales = btns.map((b) => b.dataset.locale);
    expect(locales).toEqual(["ja", "en", "ko"]);
    const labels = btns.map((b) => b.textContent);
    expect(labels).toEqual([
      LOCALE_DISPLAY_NAMES.ja,
      LOCALE_DISPLAY_NAMES.en,
      LOCALE_DISPLAY_NAMES.ko,
    ]);
    qc.dispose();
  });

  it("reflects the current locale as the checked segment on render", () => {
    setLocale("ko");
    const qc = buildQc();
    qc.open();
    const checked = qc.el.querySelector<HTMLButtonElement>(
      ".yui-lang-seg .yui-seg__btn[aria-checked='true']",
    )!;
    expect(checked.dataset.locale).toBe("ko");
    qc.dispose();
  });

  it("clicking a language segment calls setLocale with that locale", () => {
    const qc = buildQc();
    qc.open();
    expect(getLocale()).toBe("en");
    const koBtn = qc.el.querySelector<HTMLButtonElement>(
      ".yui-lang-seg .yui-seg__btn[data-locale='ko']",
    )!;
    koBtn.click();
    expect(getLocale()).toBe("ko");
    qc.dispose();
  });

  it("renders panel text via t() in the active locale", () => {
    setLocale("ko");
    const qc = buildQc();
    qc.open();
    // The reasoning-effort field label is keyed; ko renders the Korean copy.
    const label = qc.el
      .querySelector(".yui-effort-seg")!
      .closest(".yui-row")!
      .querySelector<HTMLElement>(".yui-row__label")!;
    expect(label.textContent).toBe("추론 강도");
    qc.dispose();
  });

  it("arrow keys on the language seg move roving focus only — locale is NOT committed", () => {
    setLocale("en"); // en = index 1
    const qc = buildQc();
    qc.open();

    // Watch whether arrow keys call setLocale (subscription notifies on each setLocale).
    let commits = 0;
    const unsub = i18nSubscribe(() => {
      commits += 1;
    });

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en
    btns[1].focus();

    btns[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    // No commit: locale and aria-checked stay put, only focus and roving tabindex move to ko.
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");
    expect(btns[2].getAttribute("aria-checked")).toBe("false");
    expect(document.activeElement).toBe(btns[2]);
    expect(btns[2].tabIndex).toBe(0);
    expect(btns[1].tabIndex).toBe(-1);

    // ArrowLeft moves focus back to en button only (still no commit).
    btns[2].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");
    expect(document.activeElement).toBe(btns[1]);
    expect(btns[1].tabIndex).toBe(0);

    unsub();
    qc.dispose();
  });

  it("Space on the focused locale button commits setLocale exactly once", () => {
    setLocale("en");
    const qc = buildQc();
    qc.open();

    let commits = 0;
    const unsub = i18nSubscribe(() => {
      commits += 1;
    });

    const seg = qc.el.querySelector<HTMLElement>(".yui-lang-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // Move focus to ko using arrow keys (no commit).
    btns[1].focus();
    btns[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(commits).toBe(0);
    expect(getLocale()).toBe("en");

    // Space on focused button → commit (exactly once).
    btns[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(commits).toBe(1);
    expect(getLocale()).toBe("ko");
    expect(btns[2].getAttribute("aria-checked")).toBe("true");
    expect(btns[1].getAttribute("aria-checked")).toBe("false");

    unsub();
    qc.dispose();
  });
});
