// @vitest-environment jsdom
/** cue-list.test.tsx — the cue rows, their fields, delete confirm, and edit state across new entries. */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Cue } from "../../../../settings/cues/cue-list-settings";
import type { ProactiveCue } from "../../../../settings/cues/proactive-settings";
import type { ScheduledCue } from "../../../../settings/cues/schedule-settings";
import { t } from "../../../i18n";
import { CueList } from "./cue-list";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const TIME = { kind: "time", field: "time" } as const;
const MINUTES = { kind: "minutes", field: "idle_min" } as const;

const morning: ScheduledCue = {
  id: "morning",
  label: "아침",
  context: "아침 인사",
  time: "09:00",
  enabled: true,
};
const lunch: ScheduledCue = {
  id: "lunch",
  label: "점심",
  context: "점심 인사",
  time: "12:00",
  enabled: false,
};
const breather: ProactiveCue = {
  id: "a",
  label: "잠깐 환기",
  context: "5분 넘게 조용하네",
  idle_min: 5,
  enabled: true,
};

function makeStore() {
  return { addCue: vi.fn(), updateCue: vi.fn(), removeCue: vi.fn() };
}

/** Renders a cue list; `rerender` passes new entries as the caller's subscription would. */
function build<C extends Cue>(entries: C[], trigger: typeof TIME | typeof MINUTES) {
  const store = makeStore();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const render = (next: C[]) =>
    act(() =>
      root.render(<CueList entries={next} store={store} trigger={trigger} addLabel="인사 추가" />),
    );
  render(entries);
  return { host, store, rerender: render };
}

/** The element under `sel`, asserted present so a missing one fails as an assertion. */
function q<E extends Element = HTMLElement>(scope: ParentNode, sel: string): E {
  const el = scope.querySelector<E>(sel);
  expect(el, sel).not.toBeNull();
  return el as E;
}

const row = (host: HTMLElement, id: string) =>
  q(host, `[data-testid='cue-row'][data-cue-id='${id}']`);

function change(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  act(() => {
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("CueList — rows", () => {
  it("renders one row per entry with its toggle, name, preview, switch state and off class", () => {
    const { host } = build([morning, lunch], TIME);

    expect(q(host, ".yui-cue-list").querySelectorAll("[data-testid='cue-row']")).toHaveLength(2);
    const on = row(host, "morning");
    const toggle = q<HTMLButtonElement>(on, "[data-testid='cue-toggle']");
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.querySelector(".yui-cue__chevron")).not.toBeNull();
    expect(q(toggle, ".yui-cue__name").textContent).toBe("아침");
    expect(q(toggle, "[data-testid='cue-ctx-preview']").textContent).toBe("아침 인사");
    expect(q(on, "[role=switch]").getAttribute("aria-checked")).toBe("true");
    expect(q(row(host, "lunch"), "[role=switch]").getAttribute("aria-checked")).toBe("false");
    expect(on.classList.contains("yui-cue--off")).toBe(false);
    expect(row(host, "lunch").classList.contains("yui-cue--off")).toBe(true);
    expect([...q(on, ".yui-cue__collapsed").children].map((c) => c.classList[0])).toEqual([
      "yui-cue__label",
      "yui-cue__trigger",
      "yui-switch",
      "yui-cue__delete",
    ]);
  });

  it("toggles expansion from the label, and not from the switch or ×", () => {
    const { host } = build([morning], TIME);
    const r = row(host, "morning");
    const toggle = q(r, "[data-testid='cue-toggle']");

    fireEvent.click(q(r, "[role=switch]"));
    fireEvent.click(q(r, "[data-testid='cue-delete']"));
    expect(r.classList.contains("yui-cue--expanded")).toBe(false);

    fireEvent.click(toggle);
    expect(r.classList.contains("yui-cue--expanded")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);
    expect(r.classList.contains("yui-cue--expanded")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("writes the flipped state from the entry's switch", () => {
    const { host, store } = build([morning], TIME);
    fireEvent.click(q(row(host, "morning"), "[role=switch]"));
    expect(store.updateCue).toHaveBeenCalledWith("morning", { enabled: false });
  });

  it("keys the switch, delete and context labels", () => {
    const { host } = build([{ ...morning, label: "Morning" }], TIME);
    const r = row(host, "morning");
    expect(q(r, "[role=switch]").getAttribute("aria-label")).toBe(
      t("cue.toggle_aria", { name: "Morning" }),
    );
    expect(q(r, "[data-testid='cue-delete']").getAttribute("aria-label")).toBe(t("cue.delete"));
    const ctx = q<HTMLTextAreaElement>(r, ".yui-cue__ctx-textarea");
    expect(ctx.getAttribute("aria-label")).toBe(t("cue.ctx_aria"));
    expect(ctx.placeholder).toBe(t("cue.ctx_placeholder"));
  });
});

describe("CueList — trigger field", () => {
  it.each([
    {
      kind: "time",
      entries: [morning],
      trigger: TIME,
      type: "time",
      shown: "09:00",
      typed: "10:30",
      patch: { time: "10:30" },
      aria: () => t("cue.time_aria"),
      suffix: (): string | null => null,
    },
    {
      kind: "minutes",
      entries: [{ ...breather, id: "morning" }],
      trigger: MINUTES,
      type: "number",
      shown: "5",
      typed: "15",
      patch: { idle_min: 15 },
      aria: () => t("cue.minutes_aria"),
      suffix: () => t("cue.minutes_suffix"),
    },
  ])("shows and commits the $kind value on a native change", (c) => {
    const { host, store } = build<Cue>(c.entries, c.trigger);
    const r = row(host, "morning");
    const input = q<HTMLInputElement>(r, "[data-testid='cue-trigger-input']");
    expect(input.type).toBe(c.type);
    expect(input.value).toBe(c.shown);
    expect(input.getAttribute("aria-label")).toBe(c.aria());
    expect(r.querySelector("[data-testid='cue-minutes-suffix']")?.textContent ?? null).toBe(
      c.suffix(),
    );

    change(input, c.typed);
    expect(store.updateCue).toHaveBeenCalledWith("morning", c.patch);
  });

  it("writes nothing for a non-positive minute", () => {
    const { host, store } = build([breather], MINUTES);
    change(q<HTMLInputElement>(row(host, "a"), "[data-testid='cue-trigger-input']"), "0");
    expect(store.updateCue).not.toHaveBeenCalled();
  });
});

describe("CueList — add and delete", () => {
  it("shows the add label and adds a cue on click", () => {
    const { host, store } = build<ScheduledCue>([], TIME);
    const add = q(host, ".yui-row.yui-row--action > [data-testid='cue-add']");
    expect(add.textContent).toContain("인사 추가");
    fireEvent.click(add);
    expect(store.addCue).toHaveBeenCalledOnce();
  });

  it("× opens the confirm with focus on Cancel and removes nothing", () => {
    const { host, store } = build([morning], TIME);
    const r = row(host, "morning");
    const confirm = q(r, ".yui-confirm");
    expect(confirm.hidden).toBe(true);

    const del = q(r, "[data-testid='cue-delete']");
    fireEvent.click(del);
    expect(confirm.hidden).toBe(false);
    expect(del.hidden).toBe(true);
    expect(document.activeElement).toBe(q(r, "[data-testid='cue-delete-cancel']"));
    expect(store.removeCue).not.toHaveBeenCalled();
  });

  it("Cancel hides the confirm and puts focus back on ×", () => {
    const { host, store } = build([morning], TIME);
    const r = row(host, "morning");
    const del = q(r, "[data-testid='cue-delete']");
    fireEvent.click(del);
    fireEvent.click(q(r, "[data-testid='cue-delete-cancel']"));

    expect(q(r, ".yui-confirm").hidden).toBe(true);
    expect(del.hidden).toBe(false);
    expect(document.activeElement).toBe(del);
    expect(store.removeCue).not.toHaveBeenCalled();
  });

  it("Delete removes the cue by id", () => {
    const { host, store } = build([morning], TIME);
    const r = row(host, "morning");
    fireEvent.click(q(r, "[data-testid='cue-delete']"));
    fireEvent.click(q(r, "[data-testid='cue-delete-confirm']"));
    expect(store.removeCue).toHaveBeenCalledWith("morning");
  });
});

describe("CueList — edit state across new entries", () => {
  it("keeps an open editor open and a closed one closed", () => {
    const { host, rerender } = build([morning, lunch], TIME);
    fireEvent.click(q(row(host, "morning"), "[data-testid='cue-toggle']"));
    fireEvent.click(q(row(host, "lunch"), "[data-testid='cue-toggle']"));
    fireEvent.click(q(row(host, "lunch"), "[data-testid='cue-toggle']"));

    rerender([morning, { ...lunch, enabled: true }]);

    expect(row(host, "morning").classList.contains("yui-cue--expanded")).toBe(true);
    expect(row(host, "lunch").classList.contains("yui-cue--expanded")).toBe(false);
  });

  it("keeps focus and typed text in the focused field and reflects the others", () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const { host, rerender } = build([morning, lunch], TIME);
    fireEvent.click(q(row(host, "morning"), "[data-testid='cue-toggle']"));
    const ctx = q<HTMLTextAreaElement>(row(host, "morning"), ".yui-cue__ctx-textarea");
    ctx.focus();
    ctx.value = "아직 커밋 안 된 초안";

    rerender([{ ...morning, label: "이른 아침", context: "새 인사" }, lunch]);

    const after = q<HTMLTextAreaElement>(row(host, "morning"), ".yui-cue__ctx-textarea");
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("아직 커밋 안 된 초안");
    expect(q<HTMLInputElement>(row(host, "morning"), ".yui-cue__name-input").value).toBe(
      "이른 아침",
    );
  });
});
