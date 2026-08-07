// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createRecentAppsStore } from "../../io/settings-stores";
import { setLocale } from "../i18n";
import { createDevtoolsShell } from "./shell";

const inMemoryRecentAppsStore = () => {
  let value: { value: number } | null = null;
  return createRecentAppsStore({
    load: () => value,
    save: (next) => {
      value = next;
    },
  });
};

describe("Developer Tools shell", () => {
  beforeEach(() => {
    setLocale("en");
    document.body.innerHTML = '<div id="app"></div>';
  });

  it("switches panels and marks the active navigation item", () => {
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: inMemoryRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview: vi.fn(async () => ({ dispose: vi.fn() })),
    });

    const advanced = document.querySelector<HTMLButtonElement>('[data-section="advanced"]')!;
    advanced.click();

    expect(advanced.classList.contains("is-active")).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-panel="advanced"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-panel="context"]')!.hidden).toBe(true);
    shell.dispose();
  });

  it("renders localized window chrome and navigation labels", () => {
    setLocale("ja");
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: inMemoryRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview: vi.fn(async () => ({ dispose: vi.fn() })),
    });

    expect(document.querySelector(".devtools-header")?.textContent).toBe("開発者ツール");
    expect(document.querySelector(".devtools-nav")?.getAttribute("aria-label")).toBe(
      "開発者ツールのセクション",
    );
    expect(document.querySelector('[data-section="context"]')?.textContent).toBe(
      "コンテキストインスペクター",
    );
    expect(document.querySelector('[data-section="motion"]')?.textContent).toBe(
      "モーションプレビュー",
    );
    shell.dispose();
  });

  it("disposes the motion-preview handle on shell dispose", async () => {
    const dispose = vi.fn();
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: inMemoryRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview: vi.fn(async () => ({ dispose })),
    });

    shell.activate("motion");
    await Promise.resolve();
    await Promise.resolve();

    shell.dispose();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
  });

  it("disposes the motion-preview handle once a pending load resolves", async () => {
    const dispose = vi.fn();
    let resolveLoad!: (handle: { dispose(): void }) => void;
    const loadMotionPreview = vi.fn(
      () =>
        new Promise<{ dispose(): void }>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: inMemoryRecentAppsStore(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview,
    });

    shell.activate("motion");
    shell.dispose();
    resolveLoad({ dispose });
    await Promise.resolve();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledOnce();
  });
});
