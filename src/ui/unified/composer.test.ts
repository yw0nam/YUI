// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createComposer } from "./composer";

it("shares one combobox between the mention and Backend command lists and releases it on disposal", () => {
  const mount = document.createElement("div");
  document.body.append(mount);
  const composer = createComposer({ mount, cast: () => [] });
  const field = mount.querySelector<HTMLTextAreaElement>("textarea")!;
  try {
    expect(field.getAttribute("aria-controls")).toBe("yui-uc-mention-list");
    expect(mount.querySelector<HTMLElement>(".yui-cmd-list")?.hidden).toBe(true);
    composer.dispose();
    expect(field.getAttribute("role")).toBeNull();
    expect(field.getAttribute("aria-controls")).toBeNull();
  } finally {
    composer.dispose();
    mount.remove();
  }
});
