// @vitest-environment jsdom
/**
 * cue-list.test.ts — TDD for the reusable CueList section component.
 *
 * Tests use a minimal in-memory store that matches the structural interface
 * expected by createCueList: get/setEnabled/addCue/updateCue/removeCue/subscribe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProactiveCue } from "../io/proactive-settings";
import type { ScheduledCue } from "../io/schedule-settings";
import { createCueList } from "./cue-list";
import { t } from "./i18n";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory store stubs
// ─────────────────────────────────────────────────────────────────────────────

function makeScheduleStore(overrides?: { enabled?: boolean; entries?: ScheduledCue[] }) {
  let state = {
    enabled: overrides?.enabled ?? true,
    entries: overrides?.entries ?? [
      {
        id: "morning",
        label: "아침",
        context: "아침 인사",
        time: "09:00",
        enabled: true,
      } as ScheduledCue,
      {
        id: "lunch",
        label: "점심",
        context: "점심 인사",
        time: "12:00",
        enabled: true,
      } as ScheduledCue,
    ],
  };
  const subs = new Set<(s: typeof state) => void>();

  const setEnabled = vi.fn((enabled: boolean) => {
    state = { ...state, enabled };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
  });
  const addCue = vi.fn(() => {
    const cue: ScheduledCue = {
      id: `new-${Date.now()}`,
      label: "",
      context: "",
      time: "12:00",
      enabled: true,
    };
    state = { ...state, entries: [...state.entries, cue] };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
    return { ...cue };
  });
  const updateCue = vi.fn((id: string, patch: Partial<Omit<ScheduledCue, "id">>) => {
    state = {
      ...state,
      entries: state.entries.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
  });
  const removeCue = vi.fn((id: string) => {
    state = { ...state, entries: state.entries.filter((c) => c.id !== id) };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
  });
  const subscribe = vi.fn((cb: (s: typeof state) => void) => {
    subs.add(cb);
    return () => subs.delete(cb);
  });

  return {
    get: () => ({ ...state, entries: [...state.entries] }),
    setEnabled,
    addCue,
    updateCue,
    removeCue,
    subscribe,
    _subs: subs,
  };
}

function makeProactiveStore(overrides?: { enabled?: boolean; entries?: ProactiveCue[] }) {
  let state = {
    enabled: overrides?.enabled ?? true,
    entries: overrides?.entries ?? [
      {
        id: "short_break",
        label: "잠깐 환기",
        context: "5분 환기",
        idle_min: 5,
        enabled: true,
      } as ProactiveCue,
    ],
  };
  const subs = new Set<(s: typeof state) => void>();

  const setEnabled = vi.fn((enabled: boolean) => {
    state = { ...state, enabled };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
  });
  const addCue = vi.fn(() => {
    const cue: ProactiveCue = {
      id: `new-${Date.now()}`,
      label: "",
      context: "",
      idle_min: 10,
      enabled: true,
    };
    state = { ...state, entries: [...state.entries, cue] };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
    return { ...cue };
  });
  const updateCue = vi.fn((id: string, patch: Partial<Omit<ProactiveCue, "id">>) => {
    state = {
      ...state,
      entries: state.entries.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
  });
  const removeCue = vi.fn((id: string) => {
    state = { ...state, entries: state.entries.filter((c) => c.id !== id) };
    for (const cb of subs) cb({ ...state, entries: [...state.entries] });
  });
  const subscribe = vi.fn((cb: (s: typeof state) => void) => {
    subs.add(cb);
    return () => subs.delete(cb);
  });

  return {
    get: () => ({ ...state, entries: [...state.entries] }),
    setEnabled,
    addCue,
    updateCue,
    removeCue,
    subscribe,
    _subs: subs,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared mount
// ─────────────────────────────────────────────────────────────────────────────

describe("createCueList — schedule (time trigger)", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders section header with title and sub text", () => {
    const store = makeScheduleStore();
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "정한 시각에 먼저 말을 걸어요",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    expect(mount.querySelector("[data-testid='cue-list-title']")?.textContent?.trim()).toBe(
      "시간대 인사",
    );
    expect(mount.querySelector("[data-testid='cue-list-sub']")?.textContent?.trim()).toContain(
      "정한 시각에 먼저 말을 걸어요",
    );
  });

  it("renders master switch reflecting store enabled state (true)", () => {
    const store = makeScheduleStore({ enabled: true });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const masterSwitch = mount.querySelector<HTMLButtonElement>(
      "[data-testid='cue-list-master-switch']",
    );
    expect(masterSwitch).not.toBeNull();
    expect(masterSwitch!.getAttribute("aria-checked")).toBe("true");
    expect(masterSwitch!.getAttribute("role")).toBe("switch");
  });

  it("renders master switch reflecting store enabled state (false)", () => {
    const store = makeScheduleStore({ enabled: false });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const masterSwitch = mount.querySelector<HTMLButtonElement>(
      "[data-testid='cue-list-master-switch']",
    );
    expect(masterSwitch!.getAttribute("aria-checked")).toBe("false");
  });

  it("clicking master switch calls store.setEnabled with toggled value", () => {
    const store = makeScheduleStore({ enabled: true });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const masterSwitch = mount.querySelector<HTMLButtonElement>(
      "[data-testid='cue-list-master-switch']",
    )!;
    masterSwitch.click();
    expect(store.setEnabled).toHaveBeenCalledWith(false);

    masterSwitch.click();
    expect(store.setEnabled).toHaveBeenCalledWith(true);
  });

  it("renders one cue row per entry", () => {
    const store = makeScheduleStore();
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const rows = mount.querySelectorAll("[data-testid='cue-row']");
    expect(rows.length).toBe(2);
  });

  it("renders per-cue switch with correct aria-checked", () => {
    const store = makeScheduleStore({
      entries: [
        { id: "a", label: "아침", context: "", time: "09:00", enabled: true },
        { id: "b", label: "저녁", context: "", time: "18:00", enabled: false },
      ],
    });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const rows = mount.querySelectorAll("[data-testid='cue-row']");
    expect(
      rows[0]
        .querySelector<HTMLButtonElement>("[data-testid='cue-switch']")!
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      rows[1]
        .querySelector<HTMLButtonElement>("[data-testid='cue-switch']")!
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("clicking per-cue switch calls updateCue with toggled enabled", () => {
    const store = makeScheduleStore({
      entries: [{ id: "a", label: "아침", context: "", time: "09:00", enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const cueSwitch = mount.querySelector<HTMLButtonElement>("[data-testid='cue-switch']")!;
    cueSwitch.click();
    expect(store.updateCue).toHaveBeenCalledWith("a", { enabled: false });
  });

  it("renders time input for each cue (time trigger)", () => {
    const store = makeScheduleStore();
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const timeInputs = mount.querySelectorAll<HTMLInputElement>(
      "[data-testid='cue-trigger-input']",
    );
    expect(timeInputs.length).toBe(2);
    expect(timeInputs[0].type).toBe("time");
    expect(timeInputs[0].value).toBe("09:00");
    expect(timeInputs[1].value).toBe("12:00");
  });

  it("changing time input calls updateCue with the new value", () => {
    const store = makeScheduleStore({
      entries: [{ id: "a", label: "아침", context: "", time: "09:00", enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const input = mount.querySelector<HTMLInputElement>("[data-testid='cue-trigger-input']")!;
    input.value = "10:30";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.updateCue).toHaveBeenCalledWith("a", { time: "10:30" });
  });

  it("renders add button with given label", () => {
    const store = makeScheduleStore();
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const addBtn = mount.querySelector<HTMLButtonElement>("[data-testid='cue-add']");
    expect(addBtn).not.toBeNull();
    expect(addBtn!.textContent?.trim()).toContain("인사 추가");
  });

  it("clicking add button calls store.addCue and a new row appears", () => {
    const store = makeScheduleStore({ entries: [] });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    expect(mount.querySelectorAll("[data-testid='cue-row']").length).toBe(0);
    mount.querySelector<HTMLButtonElement>("[data-testid='cue-add']")!.click();
    expect(store.addCue).toHaveBeenCalledOnce();
    expect(mount.querySelectorAll("[data-testid='cue-row']").length).toBe(1);
  });

  it("first delete click only reveals the confirm step — no removal yet", () => {
    const store = makeScheduleStore({
      entries: [{ id: "a", label: "아침", context: "", time: "09:00", enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const deleteBtn = mount.querySelector<HTMLButtonElement>("[data-testid='cue-delete']")!;
    const confirmEl = mount.querySelector<HTMLElement>(".yui-cue .yui-confirm")!;
    expect(confirmEl.hidden).toBe(true);

    deleteBtn.click();
    expect(store.removeCue).not.toHaveBeenCalled();
    expect(confirmEl.hidden).toBe(false);
  });

  it("confirm click calls store.removeCue with the correct id", () => {
    const store = makeScheduleStore({
      entries: [{ id: "a", label: "아침", context: "", time: "09:00", enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    mount.querySelector<HTMLButtonElement>("[data-testid='cue-delete']")!.click();
    mount.querySelector<HTMLButtonElement>("[data-testid='cue-delete-confirm']")!.click();
    expect(store.removeCue).toHaveBeenCalledWith("a");
  });

  it("cancel click hides the confirm step and removes nothing", () => {
    const store = makeScheduleStore({
      entries: [{ id: "a", label: "아침", context: "", time: "09:00", enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    mount.querySelector<HTMLButtonElement>("[data-testid='cue-delete']")!.click();
    mount.querySelector<HTMLButtonElement>("[data-testid='cue-delete-cancel']")!.click();

    expect(store.removeCue).not.toHaveBeenCalled();
    const confirmEl = mount.querySelector<HTMLElement>(".yui-cue .yui-confirm")!;
    expect(confirmEl.hidden).toBe(true);
  });

  it("store subscription updates the row list on external change", () => {
    const store = makeScheduleStore({ entries: [] });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    expect(mount.querySelectorAll("[data-testid='cue-row']").length).toBe(0);
    // Simulate external add
    store.addCue();
    expect(mount.querySelectorAll("[data-testid='cue-row']").length).toBe(1);
  });

  it("master switch aria-checked updates on external store.setEnabled", () => {
    const store = makeScheduleStore({ enabled: true });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const masterSwitch = mount.querySelector<HTMLButtonElement>(
      "[data-testid='cue-list-master-switch']",
    )!;
    expect(masterSwitch.getAttribute("aria-checked")).toBe("true");

    store.setEnabled(false);
    expect(masterSwitch.getAttribute("aria-checked")).toBe("false");

    store.setEnabled(true);
    expect(masterSwitch.getAttribute("aria-checked")).toBe("true");
  });

  it("section dims (yui-section--off) when master is off", () => {
    const store = makeScheduleStore({ enabled: false });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    const section = mount.querySelector("[data-testid='cue-section']");
    expect(section?.classList.contains("yui-section--off")).toBe(true);
  });

  it("section removes yui-section--off when master turns on", () => {
    const store = makeScheduleStore({ enabled: false });
    createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    store.setEnabled(true);
    const section = mount.querySelector("[data-testid='cue-section']");
    expect(section?.classList.contains("yui-section--off")).toBe(false);
  });

  it("destroy() unsubscribes and clears the mount", () => {
    const store = makeScheduleStore();
    const instance = createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });

    expect(store.subscribe).toHaveBeenCalled();
    instance.destroy();

    // After destroy, external change no longer renders
    const prevRows = mount.querySelectorAll("[data-testid='cue-row']").length;
    store.addCue();
    // Row count should not change after destroy
    expect(mount.querySelectorAll("[data-testid='cue-row']").length).toBe(prevRows);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Proactive store — "minutes" trigger
// ─────────────────────────────────────────────────────────────────────────────

describe("createCueList — proactive (minutes trigger)", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders number input for each proactive cue (minutes trigger)", () => {
    const store = makeProactiveStore({
      entries: [
        { id: "a", label: "잠깐 환기", context: "", idle_min: 5, enabled: true },
        { id: "b", label: "슬슬 체크", context: "", idle_min: 10, enabled: true },
      ],
    });
    createCueList({
      mount,
      store,
      title: "주도적 반응",
      sub: "한동안 말을 안 걸면 먼저 말을 걸어요",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ 반응 추가",
    });

    const inputs = mount.querySelectorAll<HTMLInputElement>("[data-testid='cue-trigger-input']");
    expect(inputs.length).toBe(2);
    expect(inputs[0].type).toBe("number");
    expect(inputs[0].value).toBe("5");
    expect(inputs[1].value).toBe("10");
  });

  it("changing minutes input calls updateCue with idle_min as number", () => {
    const store = makeProactiveStore({
      entries: [{ id: "a", label: "잠깐 환기", context: "", idle_min: 5, enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "주도적 반응",
      sub: "",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ 반응 추가",
    });

    const input = mount.querySelector<HTMLInputElement>("[data-testid='cue-trigger-input']")!;
    input.value = "15";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(store.updateCue).toHaveBeenCalledWith("a", { idle_min: 15 });
  });

  it("renders the '분' suffix next to minutes input", () => {
    const store = makeProactiveStore();
    createCueList({
      mount,
      store,
      title: "주도적 반응",
      sub: "",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ 반응 추가",
    });

    const suffix = mount.querySelector("[data-testid='cue-minutes-suffix']");
    expect(suffix).not.toBeNull();
    expect(suffix!.textContent).toBe(t("cue.minutes_suffix"));
  });

  it("dimmed cue row carries yui-cue--off when cue.enabled is false", () => {
    const store = makeProactiveStore({
      entries: [{ id: "a", label: "잠깐 환기", context: "", idle_min: 5, enabled: false }],
    });
    createCueList({
      mount,
      store,
      title: "주도적 반응",
      sub: "",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ 반응 추가",
    });

    const row = mount.querySelector("[data-testid='cue-row']");
    expect(row?.classList.contains("yui-cue--off")).toBe(true);
  });

  it("enabled cue row does not carry yui-cue--off", () => {
    const store = makeProactiveStore({
      entries: [{ id: "a", label: "잠깐 환기", context: "", idle_min: 5, enabled: true }],
    });
    createCueList({
      mount,
      store,
      title: "주도적 반응",
      sub: "",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ 반응 추가",
    });

    const row = mount.querySelector("[data-testid='cue-row']");
    expect(row?.classList.contains("yui-cue--off")).toBe(false);
  });

  it("renders the context preview text", () => {
    const store = makeProactiveStore({
      entries: [
        { id: "a", label: "잠깐 환기", context: "5분 넘게 조용하네", idle_min: 5, enabled: true },
      ],
    });
    createCueList({
      mount,
      store,
      title: "주도적 반응",
      sub: "",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ 반응 추가",
    });

    const preview = mount.querySelector("[data-testid='cue-ctx-preview']");
    expect(preview?.textContent?.trim()).toContain("5분 넘게 조용하네");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Re-render must not destroy the edit state (expanded editor · focus · typing)
// ─────────────────────────────────────────────────────────────────────────────

describe("createCueList — edit state survives a store-driven re-render", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function build(store: ReturnType<typeof makeScheduleStore>) {
    return createCueList({
      mount,
      store,
      title: "시간대 인사",
      sub: "",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ 인사 추가",
    });
  }

  function rowById(id: string): HTMLElement {
    return Array.from(mount.querySelectorAll<HTMLElement>("[data-testid='cue-row']")).find(
      (r) => r.getAttribute("data-cue-id") === id,
    )!;
  }

  function expand(id: string): void {
    rowById(id)
      .querySelector<HTMLElement>(".yui-cue__collapsed")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("keeps the editor expanded across an external store change", () => {
    const store = makeScheduleStore();
    build(store);

    expand("morning");
    expect(rowById("morning").classList.contains("yui-cue--expanded")).toBe(true);

    // external change (e.g. another cue toggled elsewhere) triggers a full re-render
    store.updateCue("lunch", { enabled: false });

    expect(rowById("morning").classList.contains("yui-cue--expanded")).toBe(true);
    expect(rowById("lunch").classList.contains("yui-cue--expanded")).toBe(false);
  });

  it("collapsing again is remembered across re-renders", () => {
    const store = makeScheduleStore();
    build(store);

    expand("morning");
    expand("morning"); // toggle back closed
    store.updateCue("lunch", { enabled: false });

    expect(rowById("morning").classList.contains("yui-cue--expanded")).toBe(false);
  });

  it("restores focus to the equivalent element after a re-render", () => {
    const store = makeScheduleStore();
    build(store);

    expand("morning");
    const nameInput = rowById("morning").querySelector<HTMLInputElement>(".yui-cue__name-input")!;
    nameInput.focus();
    expect(document.activeElement).toBe(nameInput);

    store.updateCue("lunch", { enabled: false });

    const restored = rowById("morning").querySelector<HTMLInputElement>(".yui-cue__name-input")!;
    expect(restored).not.toBe(nameInput); // the row was rebuilt…
    expect(document.activeElement).toBe(restored); // …but focus came back
  });

  it("preserves in-progress (uncommitted) typing in the focused field", () => {
    const store = makeScheduleStore();
    build(store);

    expand("morning");
    const ctx = rowById("morning").querySelector<HTMLTextAreaElement>(".yui-cue__ctx-textarea")!;
    ctx.focus();
    ctx.value = "아직 커밋 안 된 초안"; // typing without a change event yet

    store.updateCue("lunch", { enabled: false });

    const restored =
      rowById("morning").querySelector<HTMLTextAreaElement>(".yui-cue__ctx-textarea")!;
    expect(document.activeElement).toBe(restored);
    expect(restored.value).toBe("아직 커밋 안 된 초안");
  });
});
