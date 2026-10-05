// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { GuideKey } from "../../../../contract";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

describe("createQuickControls — help section", () => {
  let mount: HTMLElement;
  let onGuide: Mock<(guide: GuideKey, text: string) => void>;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    onGuide = vi.fn();
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function press(qc: ReturnType<typeof createQuickControls>, guide: GuideKey): void {
    qc.el.querySelector<HTMLButtonElement>(`[data-guide="${guide}"]`)!.click();
  }

  it("a button submits the current-locale request text with its guide key, after the popover closed", () => {
    const qc = createQuickControls({ ...defaultQcArgs(mount), onGuide });
    qc.open();
    onGuide.mockImplementation(() => expect(qc.isOpen()).toBe(false));

    press(qc, "controls");
    expect(onGuide).toHaveBeenLastCalledWith("controls", "YUI 조작법 알려줘");

    qc.open();
    press(qc, "capabilities");
    expect(onGuide).toHaveBeenLastCalledWith("capabilities", "YUI로 뭘 할 수 있는지 알려줘");
  });

  it("the separate settings window stays open after a press", () => {
    const qc = createQuickControls({ ...defaultQcArgs(mount), variant: "window", onGuide });
    qc.open();

    press(qc, "controls");

    expect(onGuide).toHaveBeenCalledOnce();
    expect(qc.isOpen()).toBe(true);
  });
});
