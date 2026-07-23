// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createContextHistory } from "../../io/context-history";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createRecentAppsSettings } from "../../io/recent-apps-settings";
import { setLocale } from "../i18n";
import { createDevtoolsShell } from "./shell";

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

  it("renders localized window chrome and navigation labels", () => {
    setLocale("ja");
    const shell = createDevtoolsShell({
      mount: document.querySelector("#app")!,
      history: createContextHistory(),
      contextSettings: createContextSettings(),
      recentAppsSettings: createRecentAppsSettings(),
      endpointsSettings: createEndpointsSettings(),
      loadMotionPreview: vi.fn(async () => {}),
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
});
