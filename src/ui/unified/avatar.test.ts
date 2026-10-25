// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { avatarEl, hueOf } from "./avatar";

describe("avatarEl", () => {
  it("shows the preset's photo as a round image", () => {
    const el = avatarEl({ id: "perlica", name: "Perlica", thumbnail: "asset://p.png" }, 20);

    expect(el.tagName).toBe("IMG");
    expect(el.className).toBe("yui-uc__avatar");
    expect(el.getAttribute("src")).toBe("asset://p.png");
    expect(el.getAttribute("alt")).toBe("");
  });

  it("falls back to a dot in a hue that depends only on the id", () => {
    const el = avatarEl({ id: "perlica", name: "Perlica" }, 20);

    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("yui-uc__dot");
    expect(el.style.background).toBe("oklch(0.78 0.12 293)");
    expect(hueOf("natsume")).toBe(186);
    expect(avatarEl({ id: "perlica", name: "Other" }, 12).style.background).toBe(
      el.style.background,
    );
  });
});
