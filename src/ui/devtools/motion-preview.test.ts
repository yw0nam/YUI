// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createClampedIntSettings } from "../../io/persisted-store";
import { createDevtoolsShell } from "./shell";

const createRecentAppsStore = () => createClampedIntSettings({ default: 10, floor: 1, ceil: 50 });

describe("Motion Preview section", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("loads the renderer module only on its first activation", async () => {
    const loadMotionPreview = vi.fn(async () => ({ dispose: vi.fn() }));
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: createRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview,
    });

    shell.activate("motion");
    shell.activate("context");
    shell.activate("motion");
    await Promise.resolve();

    expect(loadMotionPreview).toHaveBeenCalledOnce();
  });

  it("shows an error state when the load rejects, not the loading placeholder", async () => {
    const loadMotionPreview = vi.fn(async () => {
      throw new Error("registry load failed");
    });
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: createRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview,
    });

    shell.activate("motion");
    await Promise.resolve();
    await Promise.resolve();

    const panel = document.querySelector<HTMLElement>('[data-panel="motion"]')!;
    expect(panel.querySelector(".devtools-loading")).toBeNull();
    expect(panel.querySelector(".devtools-error")).not.toBeNull();
  });

  it("retries the load when the section is re-activated after a rejection", async () => {
    const loadMotionPreview = vi
      .fn<() => Promise<{ dispose(): void }>>()
      .mockRejectedValueOnce(new Error("registry load failed"))
      .mockResolvedValueOnce({ dispose: vi.fn() });
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: createRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview,
    });

    shell.activate("motion");
    await Promise.resolve();
    await Promise.resolve();

    shell.activate("context");
    shell.activate("motion");
    await Promise.resolve();

    expect(loadMotionPreview).toHaveBeenCalledTimes(2);
  });
});
