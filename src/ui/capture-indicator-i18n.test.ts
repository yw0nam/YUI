// @vitest-environment jsdom

/**
 * capture-indicator-i18n.test.ts
 *
 * The "watching your screen" label renders via i18n, not a baked Korean literal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./capture-indicator.css", () => ({}));

import { createCaptureIndicator } from "./capture-indicator";
import { setLocale, t } from "./i18n";

function fakeSettings(enabled: boolean) {
  return {
    get: () => ({ enabled }),
    subscribe: () => () => {},
  } as unknown as Parameters<typeof createCaptureIndicator>[0]["settings"];
}

describe("capture-indicator — i18n label", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  it("renders the watching label via i18n", () => {
    const ind = createCaptureIndicator({
      mount,
      settings: fakeSettings(true),
      onActivate: () => {},
    });
    expect(ind.el.textContent).toContain(t("capture.watching"));
  });
});
