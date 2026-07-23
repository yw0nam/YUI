// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createRecentAppsSettings } from "../../io/recent-apps-settings";
import { createDevtoolsShell } from "./shell";

describe("Developer Tools shell", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("switches panels and marks the active navigation item", () => {
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: createRecentAppsSettings(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview: vi.fn(async () => {}),
    });

    const advanced = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
    advanced.click();

    expect(advanced.classList.contains("is-active")).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-panel="advanced"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-panel="context"]')!.hidden).toBe(true);
    shell.dispose();
  });
});
