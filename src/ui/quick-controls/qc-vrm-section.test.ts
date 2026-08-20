// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/load";
import { createAgentSettings } from "../../io/agent-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createLipsyncSettings } from "../../io/lipsync-settings";
import { createProactiveSettings } from "../../io/proactive-settings";
import { createScheduleSettings } from "../../io/schedule-settings";
import type { createSpeakerSelection, SpeakerOption } from "../../io/speaker-selection";
import { createVrmSelection } from "../../io/vrm-selection";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  makeSpeakerSelection,
  makeVrmSelection,
  USER_OPTION,
} from "./test-helpers";

describe("createQuickControls — VRM section", () => {
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
  let pickVoiceImport: Mock<() => Promise<{ srcPath: string; seedName: string } | null>>;
  let commitVoiceImport: Mock<(srcPath: string, name: string) => Promise<void>>;
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
    pickVoiceImport = vi.fn<() => Promise<{ srcPath: string; seedName: string } | null>>(
      async () => null,
    );
    commitVoiceImport = vi.fn<(srcPath: string, name: string) => Promise<void>>(async () => {});
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
      pickVoiceImport,
      commitVoiceImport,
      removeUserVoice,
      ...extra,
    });
  }

  // ── VRM section ─────────────────────────────────────────────────────────────

  // microtask flush — swapVrm is async; let its promise settle before asserting.
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  it("renders one .yui-vrm radio per vrmSelection.list() entry", () => {
    const qc = buildQc();
    qc.open();

    const group = qc.el.querySelector<HTMLElement>(".yui-vrms[role=radiogroup]");
    expect(group).not.toBeNull();
    const rows = group!.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]");
    expect(rows).toHaveLength(3); // carlotta · aria · mirai
    const names = Array.from(rows).map((r) => r.querySelector(".yui-vrm__name")!.textContent);
    expect(names).toEqual(["Carlotta", "Aria", "Mirai"]);

    qc.dispose();
  });

  it("marks the active row aria-checked and shows the '사용 중' badge", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Carlotta");
    expect(active.querySelector(".yui-vrm__badge")!.textContent).toBe("사용 중");
    // non-active rows carry no badge
    for (const r of rows) {
      if (r !== active) expect(r.querySelector(".yui-vrm__badge")).toBeNull();
    }

    qc.dispose();
  });

  it("clicking a non-active row calls swapVrm with that option and shows loading", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const aria = rows[1]; // Aria
    aria.click();

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "aria", url: "/vrms/aria.vrm" });

    // loading reflected immediately (before the promise resolves)
    expect(aria.getAttribute("aria-busy")).toBe("true");
    expect(aria.querySelector(".yui-vrm__hint")!.textContent).toContain("바꾸는 중");
    const group = qc.el.querySelector<HTMLElement>(".yui-vrms")!;
    expect(group.getAttribute("aria-busy")).toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(true);

    qc.dispose();
  });

  it("on resolve the active tick + badge move to the new row and loading clears", async () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[1].click(); // Aria
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Aria");
    expect(active.querySelector(".yui-vrm__badge")!.textContent).toBe("사용 중");
    // loading cleared everywhere
    expect(qc.el.querySelector(".yui-vrm[aria-busy=true]")).toBeNull();
    const group = qc.el.querySelector<HTMLElement>(".yui-vrms")!;
    expect(group.getAttribute("aria-busy")).not.toBe("true");
    expect(group.classList.contains("is-swapping")).toBe(false);
    expect(vrmSelection.getActiveId()).toBe("aria");

    qc.dispose();
  });

  it("on reject shows the inline error and leaves the active selection unchanged", async () => {
    swapVrm = vi.fn<(option: AvatarOption) => Promise<void>>(async () => {
      throw new Error("load failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[2].click(); // Mirai
    await flush();

    const errorRow = qc.el.querySelector<HTMLButtonElement>(".yui-vrm.is-error")!;
    expect(errorRow.querySelector(".yui-vrm__name")!.textContent).toBe("Mirai");
    const errMsg = qc.el.querySelector(".yui-vrm__error")!;
    expect(errMsg.textContent).toContain("불러오지 못했어요");
    // active stays Carlotta (store never changed)
    expect(vrmSelection.getActiveId()).toBe("carlotta");
    const after = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = after.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Carlotta");
    // loading cleared
    expect(qc.el.querySelector(".yui-vrm[aria-busy=true]")).toBeNull();

    qc.dispose();
  });

  it("clicking the already-active row is a no-op (no swapVrm)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    active.click();

    expect(swapVrm).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("the '파일에서 추가…' row is enabled and invokes the import handler on click", () => {
    const qc = buildQc();
    qc.open();

    const add = qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!;
    expect(add.disabled).toBe(false);
    expect(add.hasAttribute("aria-disabled")).toBe(false);
    expect(add.classList.contains("is-ready")).toBe(true);
    // the "preparing" chip is gone now that import is wired
    expect(add.querySelector(".yui-vrm__soon")).toBeNull();
    // it is NOT a radio (excluded from the radiogroup roving order)
    expect(add.getAttribute("role")).not.toBe("radio");

    add.click();
    expect(importVrm).toHaveBeenCalledOnce();

    qc.dispose();
  });

  it("caps the list in a scroll container; the add-row footer lives OUTSIDE it", () => {
    const qc = buildQc();
    qc.open();

    const scroll = qc.el.querySelector<HTMLElement>(".yui-vrm-scroll")!;
    const group = qc.el.querySelector<HTMLElement>(".yui-vrms")!;
    const foot = qc.el.querySelector<HTMLElement>(".yui-vrm-foot")!;
    // the radiogroup is inside the capped scroll container
    expect(scroll.contains(group)).toBe(true);
    // the pinned footer (and its add-row) is NOT inside the scroll container
    expect(scroll.contains(foot)).toBe(false);
    expect(foot.querySelector(".yui-vrm--add")).not.toBeNull();

    qc.dispose();
  });

  it("ArrowDown on the VRM radiogroup moves roving focus to the next row WITHOUT swapping", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].focus();
    // active is row 0 (Carlotta); ArrowDown → roving focus to row 1 (Aria), no commit
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));

    expect(document.activeElement).toBe(rows[1]);
    expect(rows[1].tabIndex).toBe(0);
    expect(rows[0].tabIndex).toBe(-1);
    // manual activation: roving moves focus only — selection (aria-checked) must not follow
    expect(rows[1].getAttribute("aria-checked")).toBe("false");
    expect(rows[0].getAttribute("aria-checked")).toBe("true");
    expect(swapVrm).not.toHaveBeenCalled();
    expect(vrmSelection.getActiveId()).toBe("carlotta");

    qc.dispose();
  });

  it("Enter on a focused non-active VRM row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "aria" });

    qc.dispose();
  });

  it("Space on a focused non-active VRM row selects it (swaps)", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(swapVrm).toHaveBeenCalledOnce();
    expect(swapVrm.mock.calls[0][0]).toMatchObject({ id: "mirai" });

    qc.dispose();
  });

  it("renders a label with HTML metacharacters as literal text (no innerHTML injection)", () => {
    const evil = "a<img src=x onerror=alert(1)>b";
    vrmSelection = createVrmSelection({
      available: [{ id: "carlotta", label: evil, url: "/vrms/carlotta.vrm", source: "bundled" }],
      defaultValue: "/vrms/carlotta.vrm",
    });
    const qc = buildQc();
    qc.open();

    const name = qc.el.querySelector<HTMLElement>(".yui-vrm[role=radio] .yui-vrm__name")!;
    expect(name.textContent).toBe(evil);
    // no element was parsed from the label — proves textContent, not innerHTML
    expect(name.querySelector("img")).toBeNull();
    expect(qc.el.querySelector(".yui-vrms img")).toBeNull();

    qc.dispose();
  });

  it("End key on the VRM radiogroup moves roving focus to the last row WITHOUT swapping", () => {
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));

    expect(document.activeElement).toBe(rows[2]);
    expect(rows[2].tabIndex).toBe(0);
    expect(swapVrm).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("keeps the roving VRM tabindex on the last-roved row across a re-render", async () => {
    // A rejected commit on a different row re-renders (finally → renderVrms) while the
    // active id stays put — the seam that proves roving-tabindex survives a real re-render.
    swapVrm = vi.fn(async () => {
      throw new Error("load failed");
    });
    const qc = buildQc();
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    rows[0].focus();
    // rove down to Aria (unchecked) without committing → vrmRovedId = aria
    rows[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(rows[1].tabIndex).toBe(0);

    // commit Mirai (a DIFFERENT row than the roved Aria); its swap REJECTS, so active stays
    // carlotta but finally still re-renders. A wrong rovedId re-point on commit would move
    // the tab stop to Mirai — this asserts it stays on the roved Aria.
    rows[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flush();

    const after = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    expect(vrmSelection.getActiveId()).toBe("carlotta"); // rejected swap left active untouched
    // roving tabindex must remain on Aria — not snap to the checked Carlotta, nor to Mirai
    expect(after[1].tabIndex).toBe(0);
    expect(after[0].tabIndex).toBe(-1);
    expect(after[2].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("reflects an external vrmSelection change (cross-window) while open", () => {
    const qc = buildQc();
    qc.open();

    // simulate another window committing a selection
    vrmSelection.select("mirai");

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-vrm[role=radio]"));
    const active = rows.find((r) => r.getAttribute("aria-checked") === "true")!;
    expect(active.querySelector(".yui-vrm__name")!.textContent).toBe("Mirai");

    qc.dispose();
  });

  it("window variant also renders the VRM section", () => {
    const qc = buildQc({ variant: "window" });
    qc.open();

    expect(qc.el.querySelector(".yui-vrms[role=radiogroup]")).not.toBeNull();
    expect(qc.el.querySelector(".yui-vrm--add")).not.toBeNull();

    qc.dispose();
  });

  // ── BYO-VRM: user rows + import + rename + remove ───────────────────────────

  // Selection holding the three bundled rows plus one user (imported) option.
  function withUserOption() {
    vrmSelection = makeVrmSelection();
    vrmSelection.addUserOption(USER_OPTION);
  }

  function userRow(qc: { el: HTMLElement }): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`.yui-vrm[data-vrm-id="${USER_OPTION.id}"]`)!;
  }

  it("renders a user option as a div[role=radio] row carrying rename + remove controls", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    const row = userRow(qc);
    expect(row).not.toBeNull();
    // nested buttons require a div row, never a <button> (invalid nested HTML)
    expect(row.tagName).toBe("DIV");
    expect(row.getAttribute("role")).toBe("radio");
    expect(row.querySelector(".yui-vrm__name")!.textContent).toBe("깜냥이");
    expect(row.querySelector<HTMLButtonElement>(".yui-vrm__rename")).not.toBeNull();
    expect(row.querySelector<HTMLButtonElement>(".yui-vrm__remove")).not.toBeNull();

    qc.dispose();
  });

  it("bundled rows stay <button> radios with no rename/remove controls", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    const carlotta = qc.el.querySelector<HTMLElement>('.yui-vrm[data-vrm-id="carlotta"]')!;
    expect(carlotta.tagName).toBe("BUTTON");
    expect(carlotta.querySelector(".yui-vrm__rename")).toBeNull();
    expect(carlotta.querySelector(".yui-vrm__remove")).toBeNull();

    qc.dispose();
  });

  it("pencil opens inline rename; Enter commits via renameUserOption", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__rename")!.click();

    // entering rename re-renders — re-query the now-renaming row
    const row = userRow(qc);
    expect(row.classList.contains("yui-vrm--renaming")).toBe(true);
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input).not.toBeNull();
    expect(input.value).toBe("깜냥이");
    expect(row.querySelector(".yui-vrm__rename-hint")).not.toBeNull();

    input.value = "냥이";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

    expect(vrmSelection.list().find((o) => o.id === "cat")!.label).toBe("냥이");
    // input is gone after commit
    expect(userRow(qc).querySelector(".yui-ep-input")).toBeNull();

    qc.dispose();
  });

  it("Esc cancels inline rename without changing the label", () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__rename")!.click();
    const input = userRow(qc).querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = "버려질 이름";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(vrmSelection.list().find((o) => o.id === "cat")!.label).toBe("깜냥이");
    expect(userRow(qc).querySelector(".yui-ep-input")).toBeNull();
    // Esc cancels the rename only — it must NOT close the whole panel
    expect(qc.isOpen()).toBe(true);

    qc.dispose();
  });

  it("trash removes the option via removeUserVrm then store removeUserOption", async () => {
    withUserOption();
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    expect(userRow(qc).classList.contains("is-remove-armed")).toBe(true);
    expect(userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.textContent).toBe(
      "삭제할까요?",
    );
    expect(
      userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.getAttribute("aria-label"),
    ).toBe("삭제할까요? 깜냥이");
    expect(userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.dataset.tip).toBe(
      "삭제할까요?",
    );
    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    expect(removeUserVrm).toHaveBeenCalledOnce();
    expect(removeUserVrm.mock.calls[0][0]).toBe("cat");
    expect(vrmSelection.list().map((o) => o.id)).not.toContain("cat");
    expect(qc.el.querySelector('.yui-vrm[data-vrm-id="cat"]')).toBeNull();

    qc.dispose();
  });

  it("closes a tooltip that was open across the click that arms and re-renders its anchor", () => {
    vi.useFakeTimers();
    try {
      withUserOption();
      const qc = buildQc();
      qc.open();

      const remove = userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!;
      remove.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      vi.advanceTimersByTime(150);
      expect(document.querySelector(".yui-hint-tip.is-open")?.textContent).toBe("삭제");

      remove.click();

      expect(document.querySelector(".yui-hint-tip.is-open")).toBeNull();

      qc.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes the file BEFORE committing the store removal (no divergence ordering)", async () => {
    withUserOption();
    let storeStillHadCatAtDelete: boolean | null = null;
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {
      // at the moment the native delete runs, the store must not have committed yet.
      storeStillHadCatAtDelete = vrmSelection.list().some((o) => o.id === "cat");
    });
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    expect(storeStillHadCatAtDelete).toBe(true);
    expect(vrmSelection.list().map((o) => o.id)).not.toContain("cat");

    qc.dispose();
  });

  it("keeps the entry in the store when the native file delete fails (no divergence)", async () => {
    withUserOption();
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    // file delete failed → store must NOT have dropped the entry; row stays visible.
    expect(vrmSelection.list().map((o) => o.id)).toContain("cat");
    expect(qc.el.querySelector('.yui-vrm[data-vrm-id="cat"]')).not.toBeNull();

    qc.dispose();
  });

  it("does NOT fall back / swap the renderer when deleting the active VRM file fails", async () => {
    withUserOption();
    vrmSelection.select("cat");
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {
      throw new Error("native delete failed");
    });
    const qc = buildQc();
    qc.open();
    swapVrm.mockClear();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    // store still active on cat, no fallback swap attempted.
    expect(vrmSelection.getActiveId()).toBe("cat");
    expect(swapVrm).not.toHaveBeenCalled();

    qc.dispose();
  });

  it("removing the active user VRM falls back to default and swaps the renderer", async () => {
    withUserOption();
    vrmSelection.select("cat");
    const qc = buildQc();
    qc.open();

    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    userRow(qc).querySelector<HTMLButtonElement>(".yui-vrm__remove")!.click();
    await flush();

    // store fell back to the bundled default
    expect(vrmSelection.getActiveId()).toBe("carlotta");
    // renderer reloaded onto the fallback
    expect(swapVrm).toHaveBeenCalled();
    expect(swapVrm.mock.calls.at(-1)![0]).toMatchObject({ id: "carlotta" });

    qc.dispose();
  });

  it("clicking the add button enters the importing state (loading row)", () => {
    // import handler that never resolves — pins the transient importing row
    importVrm = vi.fn<() => Promise<void>>(() => new Promise<void>(() => {}));
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();

    const loading = qc.el.querySelector<HTMLElement>(".yui-vrm__loading")!;
    expect(loading).not.toBeNull();
    expect(loading.querySelector(".yui-vrm__spin")).not.toBeNull();
    expect(loading.querySelector(".yui-vrm__loading-name")!.textContent).toContain("불러오는 중");

    qc.dispose();
  });

  it("a failed import shows the inline error and clears the importing row", async () => {
    importVrm = vi.fn<() => Promise<void>>(async () => {
      throw new Error("bad vrm");
    });
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();
    await flush();

    const err = qc.el.querySelector<HTMLElement>(".yui-vrm__import-error")!;
    expect(err).not.toBeNull();
    expect(err.hidden).toBe(false);
    expect(err.textContent).toContain("불러올 수 없는 파일이에요");
    // the transient loading row is gone once the import settles
    expect(qc.el.querySelector(".yui-vrm__loading")).toBeNull();

    qc.dispose();
  });

  it("a successful import clears the importing row and error notice", async () => {
    importVrm = vi.fn<() => Promise<void>>(async () => {
      vrmSelection.addUserOption(USER_OPTION);
    });
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-vrm--add")!.click();
    await flush();

    expect(qc.el.querySelector(".yui-vrm__loading")).toBeNull();
    expect(qc.el.querySelector<HTMLElement>(".yui-vrm__import-error")!.hidden).toBe(true);
    expect(qc.el.querySelector('.yui-vrm[data-vrm-id="cat"]')).not.toBeNull();

    qc.dispose();
  });
});
