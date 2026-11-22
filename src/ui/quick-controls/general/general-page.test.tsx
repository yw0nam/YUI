// @vitest-environment jsdom
/**
 * general-page.test.tsx — the General page through its facade: the three segments, the user name
 * row, and the cross-page language cases that need the composer.
 */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CARD, type PersonaConfig } from "../../../config/validators/persona/types";
import type { Logger } from "../../../logger";
import { createTextSizeSettings } from "../../../settings/appearance/text-size-settings";
import { createThemeSettings } from "../../../settings/appearance/theme-settings";
import { createUserNameSettings } from "../../../settings/identity/user-name-settings";
import { getLocale, subscribe as i18nSubscribe, LOCALE_DISPLAY_NAMES, setLocale } from "../../i18n";
import { createGeneralPage, type GeneralPage } from "./general-page";
import type { GeneralPageViewProps } from "./general-page-view";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const persona: PersonaConfig = {
  framing: { en: "f", ja: "f", ko: "f" },
  user_fallback: { en: "User", ja: "ユーザー", ko: "사용자" },
  cards: { en: EMPTY_CARD, ja: EMPTY_CARD, ko: EMPTY_CARD },
};

const memory = () => ({ load: () => null, save: () => {} });

const pages: GeneralPage[] = [];

function build(overrides: Partial<GeneralPageViewProps> = {}) {
  const deps: GeneralPageViewProps = {
    themeSettings: createThemeSettings({ storage: memory() }),
    textSizeSettings: createTextSizeSettings({ storage: memory() }),
    userNameSettings: createUserNameSettings({ storage: memory() }),
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger,
    ...overrides,
  };
  const page = createGeneralPage(deps);
  pages.push(page);
  document.body.append(page.el);
  return { page, ...deps };
}

beforeEach(() => setLocale("en"));

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
  setLocale("en");
  vi.restoreAllMocks();
});

describe("createGeneralPage", () => {
  it("reflects and sets the theme", () => {
    const themeSettings = createThemeSettings({ storage: memory() });
    themeSettings.setTheme("hearth");
    const { page } = build({ themeSettings });
    const button = (theme: string) =>
      page.el.querySelector<HTMLButtonElement>(`.yui-theme-seg [data-value="${theme}"]`);

    expect(button("hearth")?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(button("system")!);
    expect(themeSettings.get()).toEqual({ theme: "system" });
    expect(button("system")?.getAttribute("aria-checked")).toBe("true");
    expect(button("hearth")?.getAttribute("aria-checked")).toBe("false");
    act(() => themeSettings.setTheme("dawn"));
    expect(button("dawn")?.getAttribute("aria-checked")).toBe("true");
    act(() => themeSettings.setTheme("system"));
    expect(button("system")?.getAttribute("aria-checked")).toBe("true");
  });

  it("sets the text size from its segment and reflects the store", () => {
    const { page, textSizeSettings } = build();
    const button = (label: string) =>
      [...page.el.querySelectorAll<HTMLButtonElement>(".yui-textsize-seg .yui-seg__btn")].find(
        (b) => b.textContent === label,
      );

    expect(button("100%")?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(button("125%")!);
    expect(textSizeSettings.get()).toEqual({ scale: 1.25 });
    expect(button("125%")?.getAttribute("aria-checked")).toBe("true");
    expect(button("100%")?.getAttribute("aria-checked")).toBe("false");
    act(() => textSizeSettings.setScale(0.9));
    expect(button("90%")?.getAttribute("aria-checked")).toBe("true");
    expect(button("125%")?.getAttribute("aria-checked")).toBe("false");
  });

  it("edits Your name, shows the fallback word, and follows the store", () => {
    const { page, userNameSettings } = build({ getPersona: () => persona });
    const input = page.el.querySelector<HTMLInputElement>("#yui-user-name")!;

    expect(input.placeholder).toBe("User");
    fireEvent.input(input, { target: { value: "Ren" } });
    expect(userNameSettings.get().name).toBe("Ren");

    act(() => userNameSettings.setName("Aki"));
    expect(input.value).toBe("Aki");
  });

  describe("language picker", () => {
    it("renders a 3-way language segmented control with display names", () => {
      const { page } = build();
      const seg = page.el.querySelector<HTMLElement>(".yui-lang-seg")!;
      expect(seg).not.toBeNull();
      const btns = [...seg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")];
      expect(btns.map((b) => b.dataset.value)).toEqual(["ja", "en", "ko"]);
      expect(btns.map((b) => b.textContent)).toEqual([
        LOCALE_DISPLAY_NAMES.ja,
        LOCALE_DISPLAY_NAMES.en,
        LOCALE_DISPLAY_NAMES.ko,
      ]);
    });

    it("reflects the current locale as the checked segment on render", () => {
      setLocale("ko");
      const { page } = build();
      const checked = page.el.querySelector<HTMLButtonElement>(
        ".yui-lang-seg .yui-seg__btn[aria-checked='true']",
      )!;
      expect(checked.dataset.value).toBe("ko");
    });

    it("clicking a language segment calls setLocale with that locale", () => {
      const { page } = build();
      expect(getLocale()).toBe("en");
      const koBtn = page.el.querySelector<HTMLButtonElement>(
        ".yui-lang-seg .yui-seg__btn[data-value='ko']",
      )!;
      fireEvent.click(koBtn);
      expect(getLocale()).toBe("ko");
    });

    it("arrow keys on the language seg move roving focus only — locale is NOT committed", () => {
      const { page } = build();

      // Watch whether arrow keys call setLocale (subscription notifies on each setLocale).
      let commits = 0;
      const unsub = i18nSubscribe(() => {
        commits += 1;
      });

      const btns = [...page.el.querySelectorAll<HTMLButtonElement>(".yui-lang-seg .yui-seg__btn")];
      expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en
      btns[1].focus();

      fireEvent.keyDown(btns[1], { key: "ArrowRight" });

      // No commit: locale and aria-checked stay put, only focus and roving tabindex move to ko.
      expect(commits).toBe(0);
      expect(getLocale()).toBe("en");
      expect(btns[1].getAttribute("aria-checked")).toBe("true");
      expect(btns[2].getAttribute("aria-checked")).toBe("false");
      expect(document.activeElement).toBe(btns[2]);
      expect(btns[2].tabIndex).toBe(0);
      expect(btns[1].tabIndex).toBe(-1);

      // ArrowLeft moves focus back to en button only (still no commit).
      fireEvent.keyDown(btns[2], { key: "ArrowLeft" });
      expect(commits).toBe(0);
      expect(getLocale()).toBe("en");
      expect(document.activeElement).toBe(btns[1]);
      expect(btns[1].tabIndex).toBe(0);

      unsub();
    });

    it("Space on the focused locale button commits setLocale exactly once", () => {
      const { page } = build();

      let commits = 0;
      const unsub = i18nSubscribe(() => {
        commits += 1;
      });

      const btns = [...page.el.querySelectorAll<HTMLButtonElement>(".yui-lang-seg .yui-seg__btn")];
      // Move focus to ko using arrow keys (no commit).
      btns[1].focus();
      fireEvent.keyDown(btns[1], { key: "ArrowRight" });
      expect(commits).toBe(0);
      expect(getLocale()).toBe("en");

      // Space on focused button → commit (exactly once).
      fireEvent.keyDown(btns[2], { key: " " });
      expect(commits).toBe(1);
      expect(getLocale()).toBe("ko");
      expect(btns[2].getAttribute("aria-checked")).toBe("true");
      expect(btns[1].getAttribute("aria-checked")).toBe("false");

      unsub();
    });
  });
});
