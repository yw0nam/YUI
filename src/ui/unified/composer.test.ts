// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createComposer } from "./composer";

it("keeps the mention picker's combobox attributes without a command list", () => {
  const mount = document.createElement("div");
  document.body.append(mount);
  const composer = createComposer({ mount, cast: () => [] });
  const field = mount.querySelector<HTMLTextAreaElement>("textarea")!;
  try {
    expect(field.getAttribute("aria-controls")).toBe("yui-uc-mention-list");
    expect(mount.querySelector(".yui-cmd-list")).toBeNull();
    composer.dispose();
    expect(field.getAttribute("role")).toBe("combobox");
    expect(field.getAttribute("aria-controls")).toBe("yui-uc-mention-list");
  } finally {
    composer.dispose();
    mount.remove();
  }
});
