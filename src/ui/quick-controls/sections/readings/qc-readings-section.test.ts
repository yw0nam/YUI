// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReadingsSettings } from "../../../../settings/voice/readings-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

describe("createQuickControls — reading dictionary section", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders as the last section of the Input tab, and only with a store", () => {
    const withStore = createQuickControls({
      ...defaultQcArgs(mount),
      readingsSettings: createReadingsSettings(),
    });
    const input = withStore.el.querySelector("#yui-panel-input")!;
    expect(input.querySelector(".yui-reading")).toBe(input.querySelector(".yui-sec:last-child"));
    withStore.dispose();

    const without = createQuickControls(defaultQcArgs(mount));
    expect(without.el.querySelector(".yui-reading")).toBeNull();
    without.dispose();
  });
});
