// @vitest-environment jsdom

/**
 * surfaces-i18n.test.ts
 *
 * Surfaces chrome (input placeholder, aria-labels, attach button) renders via
 * i18n keys, not baked Korean literals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));

import { setLocale, t } from "./i18n";
import { createSurfaces } from "./surfaces";

describe("surfaces — i18n chrome", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
    s = createSurfaces({ mount });
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
    setLocale("en");
  });

  it("uses i18n for the input placeholder and field aria-label", () => {
    const field = mount.querySelector<HTMLInputElement>(".yui-input__field")!;
    expect(field.placeholder).toBe(t("input.placeholder"));
    expect(field.getAttribute("aria-label")).toBe(t("aria.input_field"));
  });

  it("uses i18n for the attach button aria-label", () => {
    const attach = mount.querySelector<HTMLButtonElement>(".yui-input__attach")!;
    expect(attach.getAttribute("aria-label")).toBe(t("aria.attach_image"));
  });

  it("uses i18n for the send button aria-label and toggles to stop when busy", () => {
    const send = mount.querySelector<HTMLButtonElement>(".yui-input__send")!;
    expect(send.getAttribute("aria-label")).toBe(t("aria.send"));
    s.setBusy(true);
    expect(send.getAttribute("aria-label")).toBe(t("aria.stop"));
    s.setBusy(false);
    expect(send.getAttribute("aria-label")).toBe(t("aria.send"));
  });

  it("re-applies static labels on locale change (surfaces is not re-mounted)", () => {
    const field = mount.querySelector<HTMLInputElement>(".yui-input__field")!;
    const attach = mount.querySelector<HTMLButtonElement>(".yui-input__attach")!;
    setLocale("ja");
    expect(field.placeholder).toBe(t("input.placeholder"));
    expect(field.getAttribute("aria-label")).toBe(t("aria.input_field"));
    expect(attach.getAttribute("aria-label")).toBe(t("aria.attach_image"));
    // ja value actually differs from the en value baked at construction
    expect(field.placeholder).not.toBe("Say something…");
  });

  it("preserves the busy state when re-applying labels on locale change", () => {
    const send = mount.querySelector<HTMLButtonElement>(".yui-input__send")!;
    s.setBusy(true);
    setLocale("ja");
    expect(send.getAttribute("aria-label")).toBe(t("aria.stop"));
  });
});
