// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { act } from "react";
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
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import {
  countSubscriptions,
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
} from "../../test-helpers";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("createQuickControls — reasoning-effort row", () => {
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

    const seg = qc.el.querySelector<HTMLElement>(".yui-effort-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // order: default · none · minimal · low · medium
    expect(btns).toHaveLength(5);
    const medium = btns[4];

    fireEvent.click(medium);

    expect(agentSettings.get().reasoning_effort).toBe("medium");
    expect(medium.getAttribute("aria-checked")).toBe("true");
    for (const b of btns) {
      if (b !== medium) expect(b.getAttribute("aria-checked")).toBe("false");
    }

    act(() => qc.dispose());
  });

  it("ArrowRight on the segmented control moves selection (roving) and updates the store", async () => {
    const qc = buildQc();
    qc.open();

    const seg = qc.el.querySelector<HTMLElement>(".yui-effort-seg")!;
    const btns = Array.from(seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // start at default (index 0)
    expect(btns[0].getAttribute("aria-checked")).toBe("true");

    act(() => btns[0].focus());
    // Base UI moves focus in a microtask, so the arrow settles inside the awaited act.
    await act(async () => {
      fireEvent.keyDown(btns[0], { key: "ArrowRight" });
    });

    expect(agentSettings.get().reasoning_effort).toBe("none");
    expect(btns[1].getAttribute("aria-checked")).toBe("true");
    expect(btns[0].getAttribute("aria-checked")).toBe("false");

    act(() => qc.dispose());
  });

  // ── reflect store state on open ───────────────────────────────────────────

  it("open() reflects the store's reasoning_effort", () => {
    agentSettings.setReasoningEffort("medium");

    const qc = buildQc();
    qc.open();

    const btns = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>(".yui-effort-seg .yui-seg__btn"),
    );
    expect(btns[4].getAttribute("aria-checked")).toBe("true"); // medium
    expect(btns[0].getAttribute("aria-checked")).toBe("false");

    act(() => qc.dispose());
  });

  it("external agent settings change reflects in the panel while open", () => {
    const qc = buildQc();
    qc.open();

    act(() => agentSettings.setReasoningEffort("low"));

    const btns = Array.from(
      qc.el.querySelectorAll<HTMLButtonElement>(".yui-effort-seg .yui-seg__btn"),
    );
    expect(btns[3].getAttribute("aria-checked")).toBe("true"); // low

    act(() => qc.dispose());
  });

  it("releases every agent settings subscription on dispose", () => {
    const counts = countSubscriptions(agentSettings);
    const qc = buildQc();

    act(() => qc.dispose());

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

      act(() => qc.dispose());
    });

    it("follows a live transport change in both directions", () => {
      endpointsSettings.set({ chat_api: "responses" });
      const qc = buildQc();
      qc.open();
      const { reason, disabled } = agentControls(qc);

      act(() => endpointsSettings.set({ chat_api: "push" }));
      expect([disabled(), reason.hidden]).toEqual([true, false]);

      act(() => endpointsSettings.set({ chat_api: "responses" }));
      expect([disabled(), reason.hidden]).toEqual([false, true]);

      act(() => qc.dispose());
    });

    it("disables the segment when the bundled default transport is push", () => {
      const qc = buildQc({ getDefaultChatApi: () => "push" });
      qc.open();

      expect(agentControls(qc).disabled()).toBe(true);

      act(() => qc.dispose());
    });

    it("keeps the stored effort while the control is disabled", () => {
      agentSettings.setReasoningEffort("medium");
      endpointsSettings.set({ chat_api: "push" });
      const qc = buildQc();
      qc.open();

      expect(agentSettings.get().reasoning_effort).toBe("medium");

      act(() => qc.dispose());
    });

    it("releases every endpoints settings subscription on dispose", () => {
      const counts = countSubscriptions(endpointsSettings);
      const qc = buildQc();

      act(() => qc.dispose());

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
    act(() => qc.dispose());
  });
});
