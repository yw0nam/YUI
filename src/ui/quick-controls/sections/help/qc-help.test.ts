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

  function press(panel: string, qc: ReturnType<typeof createQuickControls>, guide: GuideKey): void {
    qc.el.querySelector<HTMLButtonElement>(`#yui-panel-${panel} [data-guide="${guide}"]`)!.click();
  }

  it("a button submits the current-locale request text with its guide key", () => {
    const qc = createQuickControls({ ...defaultQcArgs(mount), onGuide });
    qc.open();

    press("general", qc, "controls");
    expect(onGuide).toHaveBeenCalledTimes(1);
    expect(onGuide).toHaveBeenLastCalledWith("controls", "YUI 조작법 알려줘");

    press("general", qc, "capabilities");
    expect(onGuide).toHaveBeenCalledTimes(2);
    expect(onGuide).toHaveBeenLastCalledWith("capabilities", "YUI로 뭘 할 수 있는지 알려줘");

    press("conn", qc, "controls");
    expect(onGuide).toHaveBeenCalledTimes(3);
    expect(onGuide).toHaveBeenLastCalledWith("controls", "YUI 조작법 알려줘");
  });

  it("the General page opens with the Help section first", () => {
    const qc = createQuickControls({ ...defaultQcArgs(mount), onGuide });
    qc.open();

    const general = qc.el.querySelector<HTMLElement>("#yui-panel-general")!;
    const first = general.querySelector<HTMLElement>(".yui-sec")!;

    expect(first.querySelector("[data-guide]")).not.toBeNull();

    qc.dispose();
  });
});
