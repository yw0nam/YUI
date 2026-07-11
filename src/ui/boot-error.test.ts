// @vitest-environment jsdom

/**
 * boot-error.test.ts
 *
 * Boot-failure notice (issue #316): classification of the boot error into
 * actionable guidance (ConfigError → file + issues, otherwise VRM guidance),
 * and the dismissible DOM notice itself.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./boot-error.css", () => ({}));

import { ConfigError } from "../config/load";
import { bootErrorContent, showBootError } from "./boot-error";
import { setLocale, t } from "./i18n";

describe("bootErrorContent — failure classification", () => {
  beforeEach(() => setLocale("en"));

  it("ConfigError maps to config guidance naming the file, issues as detail", () => {
    const err = new ConfigError("endpoints.json", ["chat_base_url: not a valid URL"]);
    const content = bootErrorContent(err);
    expect(content.title).toBe(t("boot.error_title"));
    expect(content.guidance).toBe(t("boot.error_config", { file: "endpoints.json" }));
    expect(content.guidance).toContain("endpoints.json");
    expect(content.detail).toBe("chat_base_url: not a valid URL");
  });

  it("ConfigError with multiple issues joins them in the detail", () => {
    const err = new ConfigError("avatar.json", ["vrm_url: missing", "framing.fov: not a number"]);
    expect(bootErrorContent(err).detail).toBe("vrm_url: missing; framing.fov: not a number");
  });

  it("any other error maps to the VRM guidance with the raw error as detail", () => {
    const content = bootErrorContent(new Error("fetch of /vrms/carlotta.vrm failed"));
    expect(content.title).toBe(t("boot.error_title"));
    expect(content.guidance).toBe(t("boot.error_vrm"));
    expect(content.detail).toBe("Error: fetch of /vrms/carlotta.vrm failed");
  });
});

describe("showBootError — dismissible DOM notice", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    setLocale("en");
    document.body.innerHTML = "";
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  it("mounts a role=alert notice carrying title, guidance and detail", () => {
    const el = showBootError(mount, new Error("boom"));
    expect(el.getAttribute("role")).toBe("alert");
    expect(mount.contains(el)).toBe(true);
    expect(el.textContent).toContain(t("boot.error_title"));
    expect(el.textContent).toContain(t("boot.error_vrm"));
    expect(el.textContent).toContain("Error: boom");
  });

  it("renders ConfigError guidance with the failing file name", () => {
    const el = showBootError(mount, new ConfigError("motions.json", ["idle: vrma_path missing"]));
    expect(el.textContent).toContain("motions.json");
    expect(el.textContent).toContain("idle: vrma_path missing");
  });

  it("dismiss button removes the notice from the DOM", () => {
    const el = showBootError(mount, new Error("boom"));
    const dismiss = el.querySelector<HTMLButtonElement>(".yui-boot-error__dismiss");
    expect(dismiss).not.toBeNull();
    expect(dismiss?.getAttribute("aria-label")).toBe(t("boot.error_dismiss"));
    dismiss?.click();
    expect(mount.contains(el)).toBe(false);
  });
});
