// @vitest-environment jsdom
/**
 * quick-controls.select.test.ts — a Select popup opened on a page closes when the rail switches to
 * another page, whatever asked for the switch.
 */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActiveHoursSettings } from "../../settings/active-hours/active-hours-settings";
import { setLocale } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shownOptions = () =>
  [...document.querySelectorAll<HTMLElement>('[role="option"]')].filter(
    (o) => !o.closest("[hidden]"),
  );

describe("createQuickControls — a Select over a rail switch", () => {
  let mount: HTMLElement;
  let qc: ReturnType<typeof createQuickControls> | undefined;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    localStorage.clear();
    setLocale("en");
    mount = document.body.appendChild(document.createElement("div"));
  });

  afterEach(() => {
    act(() => qc?.dispose());
    qc = undefined;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  async function openSelect(trigger: Element): Promise<void> {
    await act(async () => {
      fireEvent.click(trigger);
    });
    expect(shownOptions().length).toBeGreaterThan(0);
  }

  it("a page request for Persona closes the chat preset Select open on Connection", async () => {
    qc = createQuickControls(defaultQcArgs(mount));
    act(() => qc!.open({ page: "conn" }));
    await openSelect(qc.el.querySelector(".yui-chat-preset")!);

    await act(async () => qc!.open({ page: "persona" }));

    expect(shownOptions()).toEqual([]);
    expect(document.querySelector(".yui-select-pop[data-open]")).toBeNull();
  });

  it("the rail leaving Persona closes its pace Select", async () => {
    const activeHoursSettings = createActiveHoursSettings({
      storage: { load: () => null, save() {} },
    });
    activeHoursSettings.setSpans([{ start: "08:00", end: "12:00", pace: "low" }]);
    qc = createQuickControls({ ...defaultQcArgs(mount), activeHoursSettings });
    act(() => qc!.open({ page: "persona" }));
    await openSelect(qc.el.querySelector(".yui-hours__pace")!);

    await act(async () => qc!.open({ page: "general" }));

    expect(shownOptions()).toEqual([]);
    expect(document.querySelector(".yui-select-pop[data-open]")).toBeNull();
  });
});
