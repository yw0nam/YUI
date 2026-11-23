// @vitest-environment jsdom
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../settings/persisted-store";
import { createGuardrailsSettings } from "../../../settings/backend/guardrails-settings";
import { createFillerSettings } from "../../../settings/voice/filler-settings";
import { setLocale, t } from "../../i18n";
import { createSwitchRows } from "../switch-row";
import { createTogetherPage } from "./together-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: ReturnType<typeof createTogetherPage>[] = [];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function build(
  rows: Parameters<typeof createTogetherPage>[0]["rows"],
  extra?: Partial<Parameters<typeof createTogetherPage>[0]>,
) {
  const page = createTogetherPage({ rows, log, ...extra });
  pages.push(page);
  document.body.append(page.el);
  return page;
}

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
  setLocale("en");
});

describe("createTogetherPage — switch rows", () => {
  it("renders no section when there are no rows and no cap", () => {
    const page = build([]);
    expect(page.el.querySelector(".yui-sec")).toBeNull();
  });

  it("renders the three switch rows in descriptor order with their label, sub and aria state", () => {
    setLocale("en");
    const rows = createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      fillerSettings: createFillerSettings(),
      unifiedChatSwitch: createFlagSettings(false),
      oneVoiceSettings: createFlagSettings(true),
      relationsSwitch: createFlagSettings(true),
    }).filter((row) => row.tab === "together");
    const page = build(rows);

    const rowsEl = [...page.el.querySelectorAll<HTMLElement>(".yui-row")];
    expect(rowsEl.map((row) => row.querySelector("button[role=switch]")!.className)).toEqual([
      "yui-switch yui-unified-switch",
      "yui-switch yui-one-voice-switch",
      "yui-switch yui-relations-switch",
    ]);
    expect(rowsEl.map((row) => row.querySelector(".yui-row__label")!.textContent)).toEqual([
      t("unified.enable_label"),
      t("one_voice.label"),
      t("relations.section"),
    ]);
    expect(rowsEl.map((row) => row.querySelector(".yui-row__sub")?.textContent ?? null)).toEqual([
      t("unified.enable_sub"),
      t("one_voice.sub"),
      null,
    ]);
    expect(
      rowsEl.map((row) => row.querySelector("button[role=switch]")!.getAttribute("aria-label")),
    ).toEqual([t("unified.enable_label"), t("one_voice.aria"), t("relations.aria")]);
    expect(
      rowsEl.map((row) => row.querySelector("button[role=switch]")!.getAttribute("aria-checked")),
    ).toEqual(["false", "true", "true"]);
  });

  it("puts the Unified chat row off on the page, and a click flips its store and logs the key", () => {
    setLocale("en");
    const unifiedChatSwitch = createFlagSettings(false);
    const rows = createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      fillerSettings: createFillerSettings(),
      unifiedChatSwitch,
    }).filter((row) => row.tab === "together");
    const page = build(rows);
    const button = page.el.querySelector<HTMLButtonElement>(".yui-unified-switch")!;

    expect(button.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(button);
    expect(unifiedChatSwitch.get().enabled).toBe(true);
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(log.info).toHaveBeenCalledWith("unified_chat_toggle", { enabled: true });
  });
});

describe("createTogetherPage — the chain cap", () => {
  it("shows the bundled default that loads after first render once the open hook runs", () => {
    let defaults: { tier2_max: number; urgent_max: number; addressed_chain_max: number } | undefined;
    const page = build([], {
      rateLimitSettings: createGuardrailsSettings(),
      getRateLimitDefaults: () => defaults,
    });
    const input = page.el.querySelector<HTMLInputElement>("#yui-rate-addressed");
    expect(input).not.toBeNull();
    if (!input) return;

    expect(input.value).toBe("");
    act(() => input.focus());
    defaults = { tier2_max: 24, urgent_max: 120, addressed_chain_max: 2 };
    act(() => page.reflect());

    expect(input.value).toBe("2");
  });
});
