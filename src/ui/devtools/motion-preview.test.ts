// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createRecentAppsSettings } from "../../io/recent-apps-settings";
import { createDevtoolsShell } from "./shell";

describe("Motion Preview section", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("loads the renderer module only on its first activation", async () => {
    const loadMotionPreview = vi.fn(async () => {});
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: createRecentAppsSettings(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview,
    });

    shell.activate("motion");
    shell.activate("context");
    shell.activate("motion");
    await Promise.resolve();

    expect(loadMotionPreview).toHaveBeenCalledOnce();
  });
});
