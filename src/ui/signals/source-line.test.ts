// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "../i18n";
import { renderSourceLine } from "./source-line";

describe("renderSourceLine", () => {
  beforeEach(() => setLocale("en"));

  it.each([
    ["urgent", "yui-source--urgent", "Urgent signal"],
    ["batched", "yui-source--batched", "Batched signal"],
  ] as const)("a %s line carries %s and the screen-reader class %s", (delivery, cls, spoken) => {
    const el = renderSourceLine({ delivery, source: "gh", text: "CI failed on main" });

    expect(el.className).toBe(`yui-source ${cls}`);
    expect(el.querySelector(".yui-source__dot")!.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelector(".yui-source__class")!.textContent).toBe(spoken);
    expect(el.querySelector(".yui-source__src")!.textContent).toBe("gh");
    expect(el.querySelector(".yui-source__text")!.textContent).toBe("CI failed on main");
    expect(el.hasAttribute("title")).toBe(false);
  });
});
